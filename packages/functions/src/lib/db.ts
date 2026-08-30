import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { SkRange, TableKey } from "./keys.js";

/** Any item stored in the single table. */
export type Item = Record<string, unknown> & TableKey;

let documentClient: DynamoDBDocumentClient | undefined;

/** Lazily-created DynamoDBDocumentClient singleton, reused across warm invocations. */
export function getClient(): DynamoDBDocumentClient {
  if (!documentClient) {
    documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return documentClient;
}

/** Override the client (tests inject an aws-sdk-client-mock instance). */
export function setClient(client: DynamoDBDocumentClient | undefined): void {
  documentClient = client;
}

/**
 * Name of the single table. `TABLE_NAME` is what the deployed function is given
 * (sst.config.ts passes it through), and what tests and local runs override. The
 * `SST_RESOURCE_Table` fallback covers a v2-style link that sets it directly.
 */
export function tableName(): string {
  const explicit = process.env.TABLE_NAME;
  if (explicit) return explicit;
  const linked = process.env.SST_RESOURCE_Table;
  if (linked) {
    const parsed: unknown = JSON.parse(linked);
    if (parsed && typeof parsed === "object" && "name" in parsed) {
      const name = (parsed as { name: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  throw new Error("Table name is not configured (set TABLE_NAME or link the SST table)");
}

export async function getItem<T extends Item = Item>(key: TableKey): Promise<T | undefined> {
  const result = await getClient().send(
    new GetCommand({ TableName: tableName(), Key: key }),
  );
  return result.Item as T | undefined;
}

export interface PutOptions {
  /** Set to fail when an item with the same key already exists. */
  ifNotExists?: boolean;
}

export async function putItem(item: Item, options: PutOptions = {}): Promise<void> {
  await getClient().send(
    new PutCommand({
      TableName: tableName(),
      Item: item,
      ...(options.ifNotExists
        ? { ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)" }
        : {}),
    }),
  );
}

export interface UpdateOptions {
  updateExpression: string;
  names?: Record<string, string>;
  values?: Record<string, unknown>;
  conditionExpression?: string;
}

/** Update an item and return the resulting item (`ALL_NEW`). */
export async function updateItem<T extends Item = Item>(
  key: TableKey,
  options: UpdateOptions,
): Promise<T | undefined> {
  const result = await getClient().send(
    new UpdateCommand({
      TableName: tableName(),
      Key: key,
      UpdateExpression: options.updateExpression,
      ...(options.names ? { ExpressionAttributeNames: options.names } : {}),
      ...(options.values ? { ExpressionAttributeValues: options.values } : {}),
      ...(options.conditionExpression
        ? { ConditionExpression: options.conditionExpression }
        : {}),
      ReturnValues: "ALL_NEW",
    }),
  );
  return result.Attributes as T | undefined;
}

export async function deleteItem(key: TableKey): Promise<void> {
  await getClient().send(new DeleteCommand({ TableName: tableName(), Key: key }));
}

/**
 * Guards against an unbounded paging loop. A game partition holds a few hundred
 * items at most, so needing more pages than this means the caller is querying
 * something it should be narrowing instead.
 */
const DEFAULT_MAX_PAGES = 20;

export interface QueryOptions {
  /** Stop after this many pages and throw. Defaults to 20. */
  maxPages?: number;
}

async function queryPages<T extends Item>(
  keyCondition: string,
  values: Record<string, unknown>,
  options: QueryOptions,
): Promise<T[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const items: T[] = [];
  let startKey: Record<string, unknown> | undefined;
  let pages = 0;
  do {
    if (pages >= maxPages) {
      throw new Error(
        `Query exceeded ${maxPages} pages (${keyCondition}); narrow the query or raise maxPages`,
      );
    }
    const result = await getClient().send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: values,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    items.push(...((result.Items ?? []) as T[]));
    startKey = result.LastEvaluatedKey;
    pages += 1;
  } while (startKey);
  return items;
}

/**
 * Query one partition, optionally restricted to a sort-key prefix. Pages until
 * DynamoDB stops returning a continuation key, up to `maxPages`.
 */
export async function queryPrefix<T extends Item = Item>(
  pk: string,
  skPrefix?: string,
  options: QueryOptions = {},
): Promise<T[]> {
  return queryPages<T>(
    skPrefix ? "pk = :pk AND begins_with(sk, :sk)" : "pk = :pk",
    skPrefix ? { ":pk": pk, ":sk": skPrefix } : { ":pk": pk },
    options,
  );
}

/**
 * Query one partition over an inclusive sort-key range — for access patterns a
 * `begins_with` prefix cannot express unambiguously (see `keys.ranges`).
 */
export async function queryRange<T extends Item = Item>(
  pk: string,
  range: SkRange,
  options: QueryOptions = {},
): Promise<T[]> {
  return queryPages<T>(
    "pk = :pk AND sk BETWEEN :start AND :end",
    { ":pk": pk, ":start": range.start, ":end": range.end },
    options,
  );
}

/** DynamoDB's name for a transaction rejected by one of its conditions. */
const TRANSACTION_CANCELLED = "TransactionCanceledException";

/** A single-item write rejected by its ConditionExpression. */
export const CONDITION_FAILED = "ConditionalCheckFailedException";

export function isTransactionCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === TRANSACTION_CANCELLED;
}

export function isConditionFailure(error: unknown): boolean {
  return error instanceof Error && error.name === CONDITION_FAILED;
}

/**
 * Per-item outcome codes from a cancelled transaction, positionally aligned
 * with the items that were sent. Lets a handler say which invariant it lost on
 * instead of reporting a generic conflict.
 */
export function cancellationCodes(error: unknown): (string | undefined)[] {
  if (!isTransactionCancelled(error)) return [];
  const reasons = (error as { CancellationReasons?: unknown }).CancellationReasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.map((reason) => {
    if (typeof reason !== "object" || reason === null) return undefined;
    const code = (reason as { Code?: unknown }).Code;
    return typeof code === "string" ? code : undefined;
  });
}

/** Write several items atomically (e.g. the game META item and its join-code item). */
export async function transactWrite(
  items: NonNullable<TransactWriteCommandInput["TransactItems"]>,
): Promise<void> {
  await getClient().send(new TransactWriteCommand({ TransactItems: items }));
}
