import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { setTeamName } from "@know-it-owl/functions/handlers/setTeamName";
import { setClient } from "@know-it-owl/functions/lib/db";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@know-it-owl/functions/lib/errors";
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
  { ...keys.player("g1", "p2"), displayName: "Bo", teamId: "t2" },
  { ...keys.player("g1", "p3"), displayName: "Cy", teamId: null },
];

const teams = [
  { ...keys.team("g1", "t1"), name: "Team 1", score: 0, doubleUsedRound: null },
  { ...keys.team("g1", "t2"), name: "Team 2", score: 3, doubleUsedRound: null },
];

function stubGame(): void {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({ Item: meta });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } })
    .resolves({ Items: players });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } })
    .resolves({ Items: teams });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } }).resolves({ Items: [] });
  ddbMock.on(UpdateCommand).resolves({});
}

const args = { gameId: "g1", playerId: "p1", teamId: "t1", name: "The Owls" };

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

describe("setTeamName", () => {
  it("renames the caller's own team", async () => {
    stubGame();
    const update = await setTeamName(args);

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.Key).toEqual(keys.team("g1", "t1"));
    expect(input.ExpressionAttributeValues).toMatchObject({ ":name": "The Owls" });
    expect(input.ConditionExpression).toBe("attribute_exists(pk)");
    expect(update.game.teams.find((team) => team.id === "t1")?.name).toBe("The Owls");
  });

  it("returns a TEAM_RENAMED update carrying the whole game", async () => {
    stubGame();
    const update = await setTeamName(args);
    expect(update).toMatchObject({ gameId: "g1", event: "TEAM_RENAMED", status: "TEAMS_SET" });
    expect(update.game.players).toHaveLength(3);
  });

  it("leaves the other teams alone", async () => {
    stubGame();
    const update = await setTeamName(args);
    expect(update.game.teams.find((team) => team.id === "t2")).toMatchObject({
      name: "Team 2",
      score: 3,
    });
  });

  it("trims the new name", async () => {
    stubGame();
    const update = await setTeamName({ ...args, name: "  The Owls  " });
    expect(update.game.teams.find((team) => team.id === "t1")?.name).toBe("The Owls");
  });

  it("refuses a player renaming a team they are not on", async () => {
    stubGame();
    await expect(setTeamName({ ...args, playerId: "p2" })).rejects.toThrow(ForbiddenError);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("refuses a player with no team at all", async () => {
    stubGame();
    await expect(setTeamName({ ...args, playerId: "p3" })).rejects.toThrow(ForbiddenError);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("rejects an unknown team", async () => {
    stubGame();
    await expect(setTeamName({ ...args, teamId: "nope" })).rejects.toThrow(NotFoundError);
  });

  it("rejects an unknown player", async () => {
    stubGame();
    await expect(setTeamName({ ...args, playerId: "nope" })).rejects.toThrow(NotFoundError);
  });

  it("rejects an unknown game", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(setTeamName(args)).rejects.toThrow(NotFoundError);
  });

  it("accepts a name at the 30-character limit", async () => {
    stubGame();
    const name = "x".repeat(30);
    const update = await setTeamName({ ...args, name });
    expect(update.game.teams.find((team) => team.id === "t1")?.name).toBe(name);
  });

  it("rejects an empty or over-long name", async () => {
    stubGame();
    await expect(setTeamName({ ...args, name: "   " })).rejects.toThrow(ValidationError);
    await expect(setTeamName({ ...args, name: "x".repeat(31) })).rejects.toThrow(
      /at most 30 characters/,
    );
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});
