import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { myTeam } from "@know-it-owl/functions/handlers/myTeam";
import { setClient } from "@know-it-owl/functions/lib/db";
import { NotFoundError, ValidationError } from "@know-it-owl/functions/lib/errors";
import * as keys from "@know-it-owl/functions/lib/keys";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;

const meta = {
  ...keys.gameMeta("g1"),
  status: "TEAMS_SET",
  gmTokenHash: "deadbeef",
  joinCode: "ABC234",
  currentRound: null,
  createdAt: "2026-08-30T00:00:00.000Z",
};

const players = [
  { ...keys.player("g1", "p1"), displayName: "Ada", teamId: "t1" },
  { ...keys.player("g1", "p2"), displayName: "Bo", teamId: "t1" },
  { ...keys.player("g1", "p3"), displayName: "Cy", teamId: "t2" },
  { ...keys.player("g1", "p4"), displayName: "Dee", teamId: null },
];

const teams = [
  { ...keys.team("g1", "t1"), name: "The Owls", score: 7, doubleUsedRound: 2 },
  { ...keys.team("g1", "t2"), name: "Team 2", score: 3, doubleUsedRound: null },
];

function stubGame(playerItems = players, teamItems = teams): void {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({ Item: meta });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } })
    .resolves({ Items: playerItems });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } })
    .resolves({ Items: teamItems });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } }).resolves({ Items: [] });
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

describe("myTeam", () => {
  it("returns the player's team with its roster", async () => {
    stubGame();
    const team = await myTeam({ gameId: "g1", playerId: "p1" });
    expect(team).toMatchObject({ id: "t1", name: "The Owls", score: 7, doubleUsedRound: 2 });
    expect(team?.players.map((player) => player.id)).toEqual(["p1", "p2"]);
  });

  it("does not include players from another team", async () => {
    stubGame();
    const team = await myTeam({ gameId: "g1", playerId: "p3" });
    expect(team?.players.map((player) => player.id)).toEqual(["p3"]);
  });

  it("returns null before teams have been drawn", async () => {
    stubGame(players, []);
    expect(await myTeam({ gameId: "g1", playerId: "p4" })).toBeNull();
  });

  it("returns null for a player who has no team yet", async () => {
    stubGame();
    expect(await myTeam({ gameId: "g1", playerId: "p4" })).toBeNull();
  });

  it("errors for a player who never joined", async () => {
    stubGame();
    await expect(myTeam({ gameId: "g1", playerId: "nope" })).rejects.toThrow(NotFoundError);
  });

  it("errors for a game that does not exist", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(myTeam({ gameId: "missing", playerId: "p1" })).rejects.toThrow(NotFoundError);
  });

  it("rejects missing arguments", async () => {
    await expect(myTeam({ gameId: "g1" })).rejects.toThrow(ValidationError);
    await expect(myTeam({ playerId: "p1" })).rejects.toThrow(ValidationError);
  });
});
