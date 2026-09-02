import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { joinGame } from "@know-it-owl/functions/handlers/joinGame";
import { setClient } from "@know-it-owl/functions/lib/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@know-it-owl/functions/lib/errors";
import * as keys from "@know-it-owl/functions/lib/keys";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;

const JOIN_CODE = "ABC234";

function meta(status = "LOBBY"): Record<string, unknown> {
  return {
    ...keys.gameMeta("g1"),
    status,
    gmTokenHash: "deadbeef",
    joinCode: JOIN_CODE,
    currentRound: null,
    createdAt: "2026-08-29T00:00:00.000Z",
  };
}

/** Wire up a game reachable by JOIN_CODE with the given players already in it. */
function stubGame(status = "LOBBY", players: Record<string, unknown>[] = []): void {
  ddbMock
    .on(GetCommand, { Key: keys.joinCode(JOIN_CODE) })
    .resolves({ Item: { ...keys.joinCode(JOIN_CODE), gameId: "g1" } });
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({ Item: meta(status) });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } })
    .resolves({ Items: players });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } }).resolves({ Items: [] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } }).resolves({ Items: [] });
  ddbMock.on(PutCommand).resolves({});
}

const args = { joinCode: JOIN_CODE, playerId: "p1", displayName: "Ada" };

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

describe("joinGame", () => {
  it("adds the player and returns the updated game", async () => {
    stubGame();
    const { game, player } = await joinGame(args);

    expect(player).toEqual({ id: "p1", displayName: "Ada", teamId: null });
    expect(game.players).toEqual([player]);
    expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.Item).toMatchObject({
      ...keys.player("g1", "p1"),
      displayName: "Ada",
      teamId: null,
    });
  });

  it("returns a PLAYER_JOINED update so subscribers see the join", async () => {
    stubGame();
    const update = await joinGame(args);

    // joinGame is in the onGameUpdated @aws_subscribe list, and AppSync only
    // fans out a mutation's own return type — so this shape is the fan-out.
    expect(update).toMatchObject({
      gameId: "g1",
      status: "LOBBY",
      currentRound: null,
      event: "PLAYER_JOINED",
    });
  });

  it("normalises the join code before looking it up", async () => {
    stubGame();
    await joinGame({ ...args, joinCode: ` ${JOIN_CODE.toLowerCase()} ` });
    const lookups = ddbMock.commandCalls(GetCommand).map((call) => call.args[0].input.Key);
    expect(lookups[0]).toEqual(keys.joinCode(JOIN_CODE));
  });

  it("trims the display name", async () => {
    stubGame();
    const { player } = await joinGame({ ...args, displayName: "  Ada  " });
    expect(player?.displayName).toBe("Ada");
  });

  it("is idempotent for a repeated join, preserving the assigned team", async () => {
    stubGame("LOBBY", [{ ...keys.player("g1", "p1"), displayName: "Ada", teamId: "t9" }]);
    const { game, player } = await joinGame({ ...args, displayName: "Ada Prime" });

    expect(player).toEqual({ id: "p1", displayName: "Ada Prime", teamId: "t9" });
    expect(game.players).toHaveLength(1);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });

  it("rejects a display name already taken by another player", async () => {
    stubGame("LOBBY", [{ ...keys.player("g1", "p2"), displayName: "ada", teamId: null }]);
    await expect(joinGame(args)).rejects.toThrow(ConflictError);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("lets a returning player keep their own name", async () => {
    stubGame("LOBBY", [{ ...keys.player("g1", "p1"), displayName: "Ada", teamId: null }]);
    await expect(joinGame(args)).resolves.toBeDefined();
  });

  it("rejects an unknown join code", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(joinGame(args)).rejects.toThrow(NotFoundError);
  });

  it("rejects a code whose game has been removed", async () => {
    ddbMock
      .on(GetCommand, { Key: keys.joinCode(JOIN_CODE) })
      .resolves({ Item: { ...keys.joinCode(JOIN_CODE), gameId: "g1" } });
    ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({});
    await expect(joinGame(args)).rejects.toThrow(NotFoundError);
  });

  it("refuses a newcomer once the game has left the lobby", async () => {
    // They would have no team, and the teams have already been drawn.
    stubGame("ROUND_ACTIVE");
    await expect(joinGame(args)).rejects.toThrow(/already started/);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("lets a player already in the game come back mid-quiz", async () => {
    // Returning is not joining. A closed tab or a stray back button should not
    // end someone's night, and their seat is the id in their own storage — so
    // the "already started" gate is for newcomers, not for them.
    stubGame("ROUND_ACTIVE", [
      { ...keys.player("g1", "p1"), displayName: "Ada", teamId: "t1" },
    ]);
    const update = await joinGame(args);

    expect(update.event).toBe("PLAYER_JOINED");
    expect(update.player?.id).toBe("p1");
    // And back onto the same team, not a fresh seat.
    expect(update.player?.teamId).toBe("t1");
    expect(update.game.players).toHaveLength(1);
  });

  it("lets them back into a game that is being marked, or is over", async () => {
    for (const status of ["GRADING", "REVEAL", "FINISHED"] as const) {
      stubGame(status, [
        { ...keys.player("g1", "p1"), displayName: "Ada", teamId: "t1" },
      ]);
      const update = await joinGame(args);
      expect(update.player?.teamId).toBe("t1");
    }
  });

  it("rejects an empty display name", async () => {
    stubGame();
    await expect(joinGame({ ...args, displayName: "   " })).rejects.toThrow(ValidationError);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it("accepts a display name at the 30-character limit", async () => {
    stubGame();
    const name = "x".repeat(30);
    await expect(joinGame({ ...args, displayName: name })).resolves.toMatchObject({
      player: { displayName: name },
    });
  });

  it("rejects an over-long display name", async () => {
    stubGame();
    await expect(joinGame({ ...args, displayName: "x".repeat(31) })).rejects.toThrow(
      /at most 30 characters/,
    );
  });

  it("rejects a missing playerId", async () => {
    stubGame();
    await expect(joinGame({ joinCode: JOIN_CODE, displayName: "Ada" })).rejects.toThrow(
      ValidationError,
    );
  });
});
