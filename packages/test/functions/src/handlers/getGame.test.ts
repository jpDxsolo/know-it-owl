import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGame, loadGameView } from "@know-it-owl/functions/handlers/getGame";
import { setClient } from "@know-it-owl/functions/lib/db";
import { ValidationError } from "@know-it-owl/functions/lib/errors";
import { hashGmToken } from "@know-it-owl/functions/lib/gmAuth";
import * as keys from "@know-it-owl/functions/lib/keys";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;

const GM_TOKEN = "gm-secret-token";

const meta = {
  ...keys.gameMeta("g1"),
  status: "ROUND_ACTIVE",
  gmTokenHash: hashGmToken(GM_TOKEN),
  joinCode: "ABC234",
  currentRound: 2,
  createdAt: "2026-08-29T00:00:00.000Z",
};

const playerItems = [
  { ...keys.player("g1", "p1"), displayName: "Ada", teamId: "t1" },
  { ...keys.player("g1", "p2"), displayName: "Bo", teamId: null },
];

const teamItems = [{ ...keys.team("g1", "t1"), name: "Owls", score: 4, doubleUsedRound: null }];

function questionItem(round: number, number: number, answer: string): Record<string, unknown> {
  return {
    ...keys.question("g1", round, number),
    type: "TEXT",
    text: `Q${number} of round ${round}`,
    correctAnswers: [answer],
    defaultPoints: 1,
  };
}

/**
 * A ROUND# query returns rounds and questions interleaved, and in sort-key
 * order — so round 10 arrives before round 2.
 */
const roundItems = [
  { ...keys.round("g1", 1), category: "History", status: "REVEALED" },
  questionItem(1, 1, "Paris"),
  { ...keys.round("g1", 10), category: "Finale", status: "DRAFT" },
  questionItem(10, 1, "Secret"),
  { ...keys.round("g1", 2), category: "Music", status: "ACTIVE" },
  questionItem(2, 1, "Bowie"),
];

function stubGame(): void {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({ Item: meta });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } })
    .resolves({ Items: playerItems });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } })
    .resolves({ Items: teamItems });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } })
    .resolves({ Items: roundItems });
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
    expect(view).toMatchObject({ id: "g1", joinCode: "ABC234", status: "ROUND_ACTIVE" });
    expect(view?.players.map((player) => player.id)).toEqual(["p1", "p2"]);
    expect(view?.teams[0].players.map((player) => player.id)).toEqual(["p1"]);
  });

  it("never exposes the stored GM token hash", async () => {
    stubGame();
    const view = await loadGameView("g1", GM_TOKEN);
    expect(JSON.stringify(view)).not.toContain(meta.gmTokenHash);
  });

  it("orders rounds numerically, not by sort key", async () => {
    stubGame();
    const view = await loadGameView("g1", GM_TOKEN);
    expect(view?.rounds.map((round) => round.number)).toEqual([1, 2, 10]);
  });

  it("returns undefined for a game that does not exist", async () => {
    ddbMock.on(GetCommand).resolves({});
    expect(await loadGameView("missing")).toBeUndefined();
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });
});

describe("loadGameView visibility", () => {
  it("hides DRAFT rounds and unrevealed answer keys from a player", async () => {
    stubGame();
    const view = await loadGameView("g1");

    expect(view?.rounds.map((round) => round.number)).toEqual([1, 2]);
    // Round 1 is REVEALED, so its key is public; round 2 is still ACTIVE.
    expect(view?.rounds[0].questions[0].correctAnswers).toEqual(["Paris"]);
    expect(view?.rounds[1].questions[0].correctAnswers).toBeNull();
  });

  it("leaks neither the draft round's category nor its answers to a player", async () => {
    stubGame();
    const serialised = JSON.stringify(await loadGameView("g1"));
    expect(serialised).not.toContain("Finale");
    expect(serialised).not.toContain("Secret");
    expect(serialised).not.toContain("Bowie");
  });

  it("gives the GM every round and every answer key", async () => {
    stubGame();
    const view = await loadGameView("g1", GM_TOKEN);

    expect(view?.rounds.map((round) => round.number)).toEqual([1, 2, 10]);
    expect(view?.rounds.flatMap((round) => round.questions.map((q) => q.correctAnswers))).toEqual([
      ["Paris"],
      ["Bowie"],
      ["Secret"],
    ]);
  });

  it("falls back to the player view for a wrong token instead of erroring", async () => {
    stubGame();
    const view = await loadGameView("g1", "not-the-token");
    expect(view?.rounds.map((round) => round.number)).toEqual([1, 2]);
    expect(view?.rounds[1].questions[0].correctAnswers).toBeNull();
  });
});

describe("getGame", () => {
  it("passes the gmToken argument through to the visibility boundary", async () => {
    stubGame();
    const asPlayer = await getGame({ gameId: "g1" });
    const asGm = await getGame({ gameId: "g1", gmToken: GM_TOKEN });
    expect(asPlayer?.rounds).toHaveLength(2);
    expect(asGm?.rounds).toHaveLength(3);
  });

  it("returns null rather than throwing for a missing game", async () => {
    ddbMock.on(GetCommand).resolves({});
    expect(await getGame({ gameId: "missing" })).toBeNull();
  });

  it("rejects a missing gameId argument", async () => {
    await expect(getGame({})).rejects.toThrow(ValidationError);
  });

  it("rejects a non-string gmToken", async () => {
    stubGame();
    await expect(getGame({ gameId: "g1", gmToken: 42 })).rejects.toThrow(ValidationError);
  });
});
