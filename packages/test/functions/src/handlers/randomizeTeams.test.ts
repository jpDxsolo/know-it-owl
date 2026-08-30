import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomizeTeams } from "@know-it-owl/functions/handlers/randomizeTeams";
import { setClient } from "@know-it-owl/functions/lib/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@know-it-owl/functions/lib/errors";
import { hashGmToken } from "@know-it-owl/functions/lib/gmAuth";
import * as keys from "@know-it-owl/functions/lib/keys";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;

const GM_TOKEN = "gm-secret-token";

function meta(status = "LOBBY"): Record<string, unknown> {
  return {
    ...keys.gameMeta("g1"),
    status,
    gmTokenHash: hashGmToken(GM_TOKEN),
    joinCode: "ABC234",
    currentRound: null,
    createdAt: "2026-08-30T00:00:00.000Z",
  };
}

function playerItems(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    ...keys.player("g1", `p${i + 1}`),
    displayName: `Player ${i + 1}`,
    teamId: null,
  }));
}

interface StubOptions {
  status?: string;
  players?: number;
  teams?: Record<string, unknown>[];
  rounds?: Record<string, unknown>[];
}

function stubGame({ status = "LOBBY", players = 5, teams = [], rounds = [] }: StubOptions = {}) {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({ Item: meta(status) });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } })
    .resolves({ Items: playerItems(players) });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } })
    .resolves({ Items: teams });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } })
    .resolves({ Items: rounds });
  ddbMock.on(TransactWriteCommand).resolves({});
}

function writes(): Record<string, unknown>[] {
  return (ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ??
    []) as Record<string, unknown>[];
}

const args = { gameId: "g1", gmToken: GM_TOKEN, teamCount: 2 };

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

describe("randomizeTeams", () => {
  it("assigns every player to one of the requested teams", async () => {
    stubGame({ players: 5 });
    const update = await randomizeTeams({ ...args, teamCount: 2 });

    expect(update.game.teams).toHaveLength(2);
    const teamIds = update.game.teams.map((team) => team.id);
    expect(update.game.players).toHaveLength(5);
    for (const player of update.game.players) {
      expect(teamIds).toContain(player.teamId);
    }
  });

  it("deals sizes differing by at most one", async () => {
    stubGame({ players: 20 });
    const update = await randomizeTeams({ ...args, teamCount: 3 });
    const sizes = update.game.teams.map((team) => team.players.length).sort();
    expect(sizes).toEqual([6, 7, 7]);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it("names new teams and starts them at zero", async () => {
    stubGame({ players: 4 });
    const update = await randomizeTeams({ ...args, teamCount: 2 });
    expect(update.game.teams.map((team) => team.name)).toEqual(["Team 1", "Team 2"]);
    expect(update.game.teams.every((team) => team.score === 0)).toBe(true);
    expect(update.game.teams.every((team) => team.doubleUsedRound === null)).toBe(true);
  });

  it("returns a TEAMS_SET update", async () => {
    stubGame();
    const update = await randomizeTeams(args);
    expect(update).toMatchObject({ gameId: "g1", event: "TEAMS_SET", status: "TEAMS_SET" });
    expect(update.game.status).toBe("TEAMS_SET");
  });

  it("writes deletes, puts and updates in a single transaction", async () => {
    const priorTeams = [
      { ...keys.team("g1", "old1"), name: "Team 1", score: 0, doubleUsedRound: null },
      { ...keys.team("g1", "old2"), name: "Team 2", score: 0, doubleUsedRound: null },
    ];
    stubGame({ status: "TEAMS_SET", players: 4, teams: priorTeams });
    await randomizeTeams(args);

    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
    const items = writes();
    // 2 deletes + 2 new teams + 4 player updates + 1 game update
    expect(items).toHaveLength(9);
    expect(items.filter((item) => "Delete" in item)).toHaveLength(2);
    expect(items.filter((item) => "Put" in item)).toHaveLength(2);
    expect(items.filter((item) => "Update" in item)).toHaveLength(5);
  });

  it("deletes exactly the prior team items", async () => {
    const priorTeams = [
      { ...keys.team("g1", "old1"), name: "Team 1", score: 0, doubleUsedRound: null },
    ];
    stubGame({ status: "TEAMS_SET", players: 2, teams: priorTeams });
    await randomizeTeams({ ...args, teamCount: 1 });

    const deletes = writes()
      .filter((item) => "Delete" in item)
      .map((item) => (item as { Delete: { Key: unknown } }).Delete.Key);
    expect(deletes).toEqual([keys.team("g1", "old1")]);
  });

  it("guards the game status inside the transaction", async () => {
    stubGame();
    await randomizeTeams(args);

    const gameUpdate = writes()
      .filter((item) => "Update" in item)
      .map((item) => (item as { Update: Record<string, unknown> }).Update)
      .find((update) => (update.Key as { sk: string }).sk === "META");
    expect(gameUpdate?.ConditionExpression).toBe("#status IN (:lobby, :teamsSet)");
  });

  it("allows a re-draw from TEAMS_SET", async () => {
    stubGame({ status: "TEAMS_SET" });
    await expect(randomizeTeams(args)).resolves.toBeDefined();
  });

  it("rejects a caller without a valid GM token", async () => {
    stubGame();
    await expect(randomizeTeams({ ...args, gmToken: "wrong" })).rejects.toThrow(ForbiddenError);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("rejects a game that has moved past the lobby", async () => {
    stubGame({ status: "ROUND_ACTIVE" });
    await expect(randomizeTeams(args)).rejects.toThrow(/before the first round/);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("refuses to re-draw once a round exists", async () => {
    stubGame({
      status: "TEAMS_SET",
      rounds: [{ ...keys.round("g1", 1), category: "History", status: "DRAFT", releasedCount: 0 }],
    });
    await expect(randomizeTeams(args)).rejects.toThrow(/once a round has been created/);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("rejects an empty lobby", async () => {
    stubGame({ players: 0 });
    await expect(randomizeTeams(args)).rejects.toThrow(ValidationError);
  });

  it("rejects more teams than players", async () => {
    stubGame({ players: 3 });
    await expect(randomizeTeams({ ...args, teamCount: 4 })).rejects.toThrow(/cannot exceed/);
  });

  it("rejects a non-positive or non-integer team count", async () => {
    stubGame();
    await expect(randomizeTeams({ ...args, teamCount: 0 })).rejects.toThrow(ValidationError);
    await expect(randomizeTeams({ ...args, teamCount: 2.5 })).rejects.toThrow(ValidationError);
  });

  it("rejects a game that does not exist", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(randomizeTeams(args)).rejects.toThrow(NotFoundError);
  });

  it("refuses a lobby too large to re-draw atomically", async () => {
    stubGame({ players: 96 });
    await expect(randomizeTeams({ ...args, teamCount: 4 })).rejects.toThrow(ConflictError);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("accepts a lobby exactly at the transaction ceiling", async () => {
    stubGame({ players: 95 });
    await expect(randomizeTeams({ ...args, teamCount: 4 })).resolves.toBeDefined();
    expect(writes()).toHaveLength(100);
  });
});
