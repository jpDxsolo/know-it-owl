import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGame } from "@know-it-owl/functions/handlers/createGame";
import { setClient } from "@know-it-owl/functions/lib/db";
import { ConflictError } from "@know-it-owl/functions/lib/errors";
import { hashGmToken } from "@know-it-owl/functions/lib/gmAuth";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;

/** What DynamoDB throws when a transaction's ConditionExpression fails. */
function cancelled(): Error {
  const error = new Error("Transaction cancelled, please refer cancellation reasons");
  error.name = "TransactionCanceledException";
  return error;
}

function putItems(callIndex = 0): Record<string, unknown>[] {
  const input = ddbMock.commandCalls(TransactWriteCommand)[callIndex].args[0].input;
  return (input.TransactItems ?? []).map(
    (entry) => (entry.Put?.Item ?? {}) as Record<string, unknown>,
  );
}

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "kio-table";
  setClient(DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })));
});

afterEach(() => setClient(undefined));

afterAll(() => {
  if (originalTableName === undefined) delete process.env.TABLE_NAME;
  else process.env.TABLE_NAME = originalTableName;
});

describe("createGame", () => {
  it("returns a LOBBY game with an empty roster", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    const { game } = await createGame();
    expect(game.status).toBe("LOBBY");
    expect(game.currentRound).toBeNull();
    expect(game.players).toEqual([]);
    expect(game.teams).toEqual([]);
    expect(game.rounds).toEqual([]);
    expect(game.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });

  it("stores only the hash of the GM token, never the token", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    const { gmToken } = await createGame();

    const written = putItems();
    const meta = written.find((item) => item.sk === "META" && "gmTokenHash" in item);
    expect(meta?.gmTokenHash).toBe(hashGmToken(gmToken));
    expect(JSON.stringify(written)).not.toContain(gmToken);
  });

  it("returns the token exactly once, and never in the game payload", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    const payload = await createGame();
    expect(typeof payload.gmToken).toBe("string");
    expect(JSON.stringify(payload.game)).not.toContain(payload.gmToken);
  });

  it("writes the join-code item and the meta item under attribute_not_exists", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    const { game } = await createGame();

    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(2);
    expect(items.every((entry) => entry.Put?.ConditionExpression === "attribute_not_exists(pk)")).toBe(
      true,
    );
    const [codeItem, metaItem] = items.map((entry) => entry.Put?.Item as Record<string, unknown>);
    expect(codeItem).toMatchObject({ pk: `JOINCODE#${game.joinCode}`, sk: "META", gameId: game.id });
    expect(metaItem).toMatchObject({ pk: `GAME#${game.id}`, sk: "META", joinCode: game.joinCode });
  });

  it("retries with a fresh join code when the code is taken", async () => {
    ddbMock.on(TransactWriteCommand).rejectsOnce(cancelled()).resolves({});
    const { game } = await createGame();

    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(2);
    const first = putItems(0)[0].pk;
    expect(first).not.toBe(`JOINCODE#${game.joinCode}`);
    // The game id survives the retry; only the code is regenerated.
    expect(putItems(0)[1].pk).toBe(`GAME#${game.id}`);
  });

  it("gives up with a ConflictError after five collisions", async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled());
    await expect(createGame()).rejects.toThrow(ConflictError);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(5);
  });

  it("does not retry an error that is not a cancelled transaction", async () => {
    ddbMock.on(TransactWriteCommand).rejects(new Error("throttled"));
    await expect(createGame()).rejects.toThrow(/throttled/);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
  });
});
