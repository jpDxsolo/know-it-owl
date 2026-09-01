import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setClient } from "@know-it-owl/functions/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@know-it-owl/functions/lib/errors";
import { hashGmToken } from "@know-it-owl/functions/lib/gmAuth";
import { finishGame } from "@know-it-owl/functions/handlers/finishGame";
import * as keys from "@know-it-owl/functions/lib/keys";
import type { GameStatus } from "@know-it-owl/core";

const ddbMock = mockClient(DynamoDBDocumentClient);
const TOKEN = "host-token";

/** The game partition as `loadGameState` reads it: the meta item, then prefixes. */
function stubGame(status: GameStatus): void {
  ddbMock.reset();
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({
    Item: {
      ...keys.gameMeta("g1"),
      status,
      gmTokenHash: hashGmToken(TOKEN),
      joinCode: "ABC123",
      currentRound: 1,
      createdAt: "2026-08-30T00:00:00.000Z",
    },
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } }).resolves({
    Items: [{ ...keys.player("g1", "p1"), displayName: "Ada", teamId: "t1" }],
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } }).resolves({
    Items: [
      {
        ...keys.team("g1", "t1"),
        name: "Owls",
        score: 24,
        doubleUsedRound: 1,
        lastSubmittedRound: 1,
      },
    ],
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } }).resolves({
    Items: [{ ...keys.round("g1", 1), category: "Capitals", status: "REVEALED", releasedCount: 1 }],
  });
  ddbMock.on(TransactWriteCommand).resolves({});
}

const args = () => ({ gameId: "g1", gmToken: TOKEN });

beforeEach(() => {
  process.env.TABLE_NAME = "kio-table";
  setClient(DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })));
});

afterEach(() => {
  ddbMock.reset();
  delete process.env.TABLE_NAME;
  setClient(undefined);
});

describe("finishGame", () => {
  it("moves a revealed game to FINISHED", async () => {
    stubGame("REVEAL");
    const update = await finishGame(args());

    expect(update.event).toBe("GAME_FINISHED");
    expect(update.status).toBe("FINISHED");
    expect(update.game.status).toBe("FINISHED");
  });

  it("guards the write, so it loses to a host who started another round", async () => {
    stubGame("REVEAL");
    await finishGame(args());

    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(1);
    const update = (items[0] as { Update: Record<string, unknown> }).Update;
    expect(update.ConditionExpression).toBe("#status = :reveal");
    expect(update.ExpressionAttributeValues).toEqual({
      ":finished": "FINISHED",
      ":reveal": "REVEAL",
    });
  });

  it("leaves the scores exactly as they were", async () => {
    // Finishing is a status change and nothing else: the standings a player saw
    // a moment earlier must be the standings they are left with.
    stubGame("REVEAL");
    const update = await finishGame(args());
    expect(update.game.teams.map((team) => team.score)).toEqual([24]);
  });

  it("refuses mid-round, where a team's answers are not yet in the scores", async () => {
    for (const status of ["ROUND_ACTIVE", "GRADING"] as const) {
      stubGame(status);
      await expect(finishGame(args())).rejects.toThrow(/reveal the round in play/i);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    }
  });

  it("says so when the game has already finished", async () => {
    stubGame("FINISHED");
    await expect(finishGame(args())).rejects.toThrow(/already finished/i);
  });

  it("refuses anyone but the host", async () => {
    stubGame("REVEAL");
    await expect(finishGame({ ...args(), gmToken: "not-the-token" })).rejects.toThrow(
      ForbiddenError,
    );
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("rejects a missing game and missing arguments", async () => {
    ddbMock.reset();
    ddbMock.on(GetCommand).resolves({});
    await expect(finishGame(args())).rejects.toThrow(NotFoundError);

    stubGame("REVEAL");
    await expect(finishGame({ gameId: "g1" })).rejects.toThrow();
  });

  it("is reachable through the resolver", async () => {
    // A handler wired into the schema but not the router is a runtime 500 that
    // no unit test of the handler itself would ever see.
    const { handler } = await import("@know-it-owl/functions/resolver");
    stubGame("REVEAL");
    const result = await handler({
      info: { fieldName: "finishGame" },
      arguments: args(),
    } as never);
    expect((result as { event: string }).event).toBe("GAME_FINISHED");
  });
});

/** Kept honest: a ConflictError is what the screens key their messages off. */
describe("finishGame conflicts", () => {
  it("is a ConflictError, not a generic failure", async () => {
    stubGame("ROUND_ACTIVE");
    await expect(finishGame(args())).rejects.toBeInstanceOf(ConflictError);
  });
});
