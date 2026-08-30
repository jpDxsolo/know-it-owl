import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGame, loadGameView } from "@know-it-owl/functions/handlers/getGame";
import { setClient } from "@know-it-owl/functions/lib/db";
import { ValidationError } from "@know-it-owl/functions/lib/errors";
import * as keys from "@know-it-owl/functions/lib/keys";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;

const meta = {
  ...keys.gameMeta("g1"),
  status: "TEAMS_SET",
  gmTokenHash: "deadbeef",
  joinCode: "ABC234",
  currentRound: null,
  createdAt: "2026-08-29T00:00:00.000Z",
};

const playerItems = [
  { ...keys.player("g1", "p1"), displayName: "Ada", teamId: "t1" },
  { ...keys.player("g1", "p2"), displayName: "Bo", teamId: null },
];

const teamItems = [{ ...keys.team("g1", "t1"), name: "Owls", score: 4, doubleUsedRound: null }];

function stubGame(): void {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({ Item: meta });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } })
    .resolves({ Items: playerItems });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } })
    .resolves({ Items: teamItems });
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

describe("loadGameView", () => {
  it("assembles the game with its players and teams", async () => {
    stubGame();
    const view = await loadGameView("g1");
    expect(view).toMatchObject({ id: "g1", joinCode: "ABC234", status: "TEAMS_SET" });
    expect(view?.players.map((player) => player.id)).toEqual(["p1", "p2"]);
    expect(view?.teams[0].players.map((player) => player.id)).toEqual(["p1"]);
  });

  it("never exposes the stored GM token hash", async () => {
    stubGame();
    const view = await loadGameView("g1");
    expect(JSON.stringify(view)).not.toContain("deadbeef");
  });

  it("queries only players and teams, so answer keys are never read", async () => {
    stubGame();
    await loadGameView("g1");
    const prefixes = ddbMock
      .commandCalls(QueryCommand)
      .map((call) => call.args[0].input.ExpressionAttributeValues?.[":sk"]);
    expect(prefixes.sort()).toEqual(["PLAYER#", "TEAM#"]);
  });

  it("returns undefined for a game that does not exist", async () => {
    ddbMock.on(GetCommand).resolves({});
    expect(await loadGameView("missing")).toBeUndefined();
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});

describe("getGame", () => {
  it("returns null rather than throwing for a missing game", async () => {
    ddbMock.on(GetCommand).resolves({});
    expect(await getGame({ gameId: "missing" })).toBeNull();
  });

  it("rejects a missing gameId argument", async () => {
    await expect(getGame({})).rejects.toThrow(ValidationError);
  });
});
