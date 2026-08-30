import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteItem,
  getItem,
  putItem,
  queryPrefix,
  setClient,
  tableName,
  transactWrite,
  updateItem,
} from "@know-it-owl/functions/lib/db";
import * as keys from "@know-it-owl/functions/lib/keys";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "kio-table";
  setClient(DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })));
});

afterEach(() => {
  setClient(undefined);
  delete process.env.SST_RESOURCE_Table;
});

afterAll(() => {
  if (originalTableName === undefined) delete process.env.TABLE_NAME;
  else process.env.TABLE_NAME = originalTableName;
});

describe("tableName", () => {
  it("prefers TABLE_NAME", () => {
    expect(tableName()).toBe("kio-table");
  });

  it("falls back to the linked SST resource", () => {
    delete process.env.TABLE_NAME;
    process.env.SST_RESOURCE_Table = JSON.stringify({ name: "linked-table", type: "dynamo" });
    expect(tableName()).toBe("linked-table");
  });

  it("throws when nothing is configured", () => {
    delete process.env.TABLE_NAME;
    expect(() => tableName()).toThrow(/not configured/);
  });
});

describe("db helpers", () => {
  it("gets an item by key", async () => {
    const item = { ...keys.gameMeta("g1"), joinCode: "ABC123" };
    ddbMock.on(GetCommand).resolves({ Item: item });

    await expect(getItem(keys.gameMeta("g1"))).resolves.toEqual(item);
    expect(ddbMock.commandCalls(GetCommand)[0].args[0].input).toEqual({
      TableName: "kio-table",
      Key: { pk: "GAME#g1", sk: "META" },
    });
  });

  it("returns undefined for a missing item", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(getItem(keys.gameMeta("nope"))).resolves.toBeUndefined();
  });

  it("puts an item, optionally guarding against overwrite", async () => {
    ddbMock.on(PutCommand).resolves({});
    const item = { ...keys.player("g1", "p1"), displayName: "Ada" };

    await putItem(item);
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.ConditionExpression).toBeUndefined();

    await putItem(item, { ifNotExists: true });
    expect(ddbMock.commandCalls(PutCommand)[1].args[0].input.ConditionExpression).toBe(
      "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    );
  });

  it("updates an item and returns the new attributes", async () => {
    const updated = { ...keys.team("g1", "t1"), score: 5 };
    ddbMock.on(UpdateCommand).resolves({ Attributes: updated });

    await expect(
      updateItem(keys.team("g1", "t1"), {
        updateExpression: "SET #s = :s",
        names: { "#s": "score" },
        values: { ":s": 5 },
        conditionExpression: "attribute_exists(pk)",
      }),
    ).resolves.toEqual(updated);

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.UpdateExpression).toBe("SET #s = :s");
    expect(input.ExpressionAttributeNames).toEqual({ "#s": "score" });
    expect(input.ConditionExpression).toBe("attribute_exists(pk)");
    expect(input.ReturnValues).toBe("ALL_NEW");
  });

  it("deletes an item", async () => {
    ddbMock.on(DeleteCommand).resolves({});
    await deleteItem(keys.player("g1", "p1"));
    expect(ddbMock.commandCalls(DeleteCommand)[0].args[0].input.Key).toEqual({
      pk: "GAME#g1",
      sk: "PLAYER#p1",
    });
  });

  it("queries a whole partition when no prefix is given", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await queryPrefix(keys.gamePk("g1"));
    const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(input.KeyConditionExpression).toBe("pk = :pk");
    expect(input.ExpressionAttributeValues).toEqual({ ":pk": "GAME#g1" });
  });

  it("queries by sort-key prefix and follows pagination", async () => {
    const page1 = [{ ...keys.player("g1", "p1"), displayName: "Ada" }];
    const page2 = [{ ...keys.player("g1", "p2"), displayName: "Bo" }];
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: page1, LastEvaluatedKey: { pk: "GAME#g1", sk: "PLAYER#p1" } })
      .resolvesOnce({ Items: page2 });

    await expect(queryPrefix(keys.gamePk("g1"), keys.prefixes.players())).resolves.toEqual([
      ...page1,
      ...page2,
    ]);

    const calls = ddbMock.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0].input.KeyConditionExpression).toBe(
      "pk = :pk AND begins_with(sk, :sk)",
    );
    expect(calls[0].args[0].input.ExclusiveStartKey).toBeUndefined();
    expect(calls[1].args[0].input.ExclusiveStartKey).toEqual({
      pk: "GAME#g1",
      sk: "PLAYER#p1",
    });
  });

  it("writes several items in one transaction", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    await transactWrite([
      { Put: { TableName: "kio-table", Item: { ...keys.gameMeta("g1") } } },
      { Put: { TableName: "kio-table", Item: { ...keys.joinCode("ABC123"), gameId: "g1" } } },
    ]);
    expect(ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems).toHaveLength(
      2,
    );
  });

  it("propagates DynamoDB failures to the caller", async () => {
    ddbMock.on(PutCommand).rejects(new Error("ConditionalCheckFailedException"));
    await expect(putItem({ ...keys.gameMeta("g1") }, { ifNotExists: true })).rejects.toThrow(
      "ConditionalCheckFailedException",
    );
  });
});
