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
import type { TableKey } from "./keys.js";

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
 * Name of the single table. SST links it as `SST_RESOURCE_Table`; `TABLE_NAME`
 * wins when set so tests and local runs can point elsewhere.
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
 * Query one partition, optionally restricted to a sort-key prefix. Pages until
 * DynamoDB stops returning a continuation key — game partitions are small.
 */
export async function queryPrefix<T extends Item = Item>(
  pk: string,
  skPrefix?: string,
): Promise<T[]> {
  const items: T[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await getClient().send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: skPrefix
          ? "pk = :pk AND begins_with(sk, :sk)"
          : "pk = :pk",
        ExpressionAttributeValues: skPrefix ? { ":pk": pk, ":sk": skPrefix } : { ":pk": pk },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    items.push(...((result.Items ?? []) as T[]));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return items;
}

/** Write several items atomically (e.g. the game META item and its join-code item). */
export async function transactWrite(
  items: NonNullable<TransactWriteCommandInput["TransactItems"]>,
): Promise<void> {
  await getClient().send(new TransactWriteCommand({ TransactItems: items }));
}
