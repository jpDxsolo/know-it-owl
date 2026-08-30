import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { endRound } from "@know-it-owl/functions/handlers/endRound";
import { gradeResponse } from "@know-it-owl/functions/handlers/gradeResponse";
import { roundResults } from "@know-it-owl/functions/handlers/roundResults";
import { standings } from "@know-it-owl/functions/handlers/standings";
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

function questionItem(number: number, type = "TEXT"): Record<string, unknown> {
  return {
    ...keys.question("g1", 1, number),
    type,
    ...(type === "TEXT" ? { text: `Q${number}` } : { imageKey: "images/g1/birds.png" }),
    correctAnswers:
      type === "TEXT" ? [`Answer ${number}`] : Array.from({ length: 10 }, (_, i) => `Bird ${i + 1}`),
    defaultPoints: type === "TEXT" ? 1 : 10,
  };
}

function responseItem(
  questionNumber: number,
  teamId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...keys.response("g1", 1, questionNumber, teamId),
    answers: ["Paris"],
    doubled: false,
    graded: false,
    gradedPoints: null,
    ...overrides,
  };
}

interface StubOptions {
  gameStatus?: string;
  roundStatus?: string;
  questionTypes?: string[];
  teams?: Record<string, unknown>[];
  responses?: Record<string, unknown>[];
}

function stubGame({
  gameStatus = "ROUND_ACTIVE",
  roundStatus = "ACTIVE",
  questionTypes = ["TEXT", "TEXT"],
  teams = [
    { ...keys.team("g1", "t1"), name: "Owls", score: 10, doubleUsedRound: null },
    { ...keys.team("g1", "t2"), name: "Hawks", score: 4, doubleUsedRound: null },
  ],
  responses = [],
}: StubOptions = {}) {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({
    Item: {
      ...keys.gameMeta("g1"),
      status: gameStatus,
      gmTokenHash: hashGmToken(GM_TOKEN),
      joinCode: "ABC234",
      currentRound: 1,
      createdAt: "2026-08-30T00:00:00.000Z",
    },
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } }).resolves({
    Items: [
      { ...keys.player("g1", "p1"), displayName: "Ada", teamId: "t1" },
      { ...keys.player("g1", "p2"), displayName: "Bo", teamId: "t2" },
    ],
  });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } })
    .resolves({ Items: teams });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } }).resolves({
    Items: [
      {
        ...keys.round("g1", 1),
        category: "History",
        status: roundStatus,
        releasedCount: questionTypes.length,
      },
      ...questionTypes.map((type, i) => questionItem(i + 1, type)),
    ],
  });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "RESP#1#" } })
    .resolves({ Items: responses });
  ddbMock.on(TransactWriteCommand).resolves({});
}

function writes(): Record<string, unknown>[] {
  return (ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ??
    []) as Record<string, unknown>[];
}

function updateAt(index: number): Record<string, unknown> {
  return (writes()[index] as { Update: Record<string, unknown> }).Update;
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

function gradeArgs(overrides: Record<string, unknown> = {}) {
  return {
    input: {
      gameId: "g1",
      gmToken: GM_TOKEN,
      roundNumber: 1,
      questionNumber: 1,
      teamId: "t1",
      points: [1],
      ...overrides,
    },
  };
}

describe("gradeResponse", () => {
  beforeEach(() => {
    ddbMock.on(GetCommand, { Key: keys.response("g1", 1, 1, "t1") }).resolves({
      Item: responseItem(1, "t1", { doubled: true }),
    });
  });

  it("stores the points as entered and moves the round to GRADING", async () => {
    stubGame();
    const graded = await gradeResponse(gradeArgs({ points: [3] }));

    expect(updateAt(0)).toMatchObject({
      Key: keys.response("g1", 1, 1, "t1"),
      ConditionExpression: "attribute_exists(sk)",
      ExpressionAttributeValues: { ":points": [3], ":graded": true },
    });
    expect(updateAt(1)).toMatchObject({
      Key: keys.round("g1", 1),
      ExpressionAttributeValues: { ":grading": "GRADING" },
    });
    expect(graded).toMatchObject({ graded: true, gradedPoints: [3], doubled: true });
  });

  it("does not multiply the points of a doubled response", async () => {
    stubGame();
    const graded = await gradeResponse(gradeArgs({ points: [4] }));
    expect(graded.doubled).toBe(true);
    expect(graded.gradedPoints).toEqual([4]);
  });

  it("requires one point value per TEXT answer and ten for a PICTURE_10", async () => {
    stubGame({ questionTypes: ["TEXT", "PICTURE_10"] });
    await expect(gradeResponse(gradeArgs({ points: [1, 2] }))).rejects.toThrow(
      /exactly 1 point value, got 2/,
    );

    ddbMock.on(GetCommand, { Key: keys.response("g1", 1, 2, "t1") }).resolves({
      Item: responseItem(2, "t1"),
    });
    await expect(
      gradeResponse(gradeArgs({ questionNumber: 2, points: [1] })),
    ).rejects.toThrow(/exactly 10 point values, got 1/);
    await expect(
      gradeResponse(gradeArgs({ questionNumber: 2, points: Array(10).fill(1) })),
    ).resolves.toBeDefined();
  });

  it("rejects non-integer and negative points", async () => {
    stubGame();
    await expect(gradeResponse(gradeArgs({ points: [1.5] }))).rejects.toThrow(ValidationError);
    await expect(gradeResponse(gradeArgs({ points: [-1] }))).rejects.toThrow(
      /non-negative integers/,
    );
    await expect(gradeResponse(gradeArgs({ points: "3" }))).rejects.toThrow(ValidationError);
  });

  it("regrades a round already in GRADING", async () => {
    stubGame({ roundStatus: "GRADING" });
    await expect(gradeResponse(gradeArgs({ points: [0] }))).resolves.toMatchObject({
      gradedPoints: [0],
    });
  });

  it("refuses to grade a revealed or unstarted round", async () => {
    stubGame({ roundStatus: "REVEALED" });
    await expect(gradeResponse(gradeArgs())).rejects.toThrow(/already been revealed/);
    stubGame({ roundStatus: "DRAFT" });
    await expect(gradeResponse(gradeArgs())).rejects.toThrow(/has not started/);
  });

  it("reports a team that never submitted", async () => {
    stubGame();
    ddbMock.on(GetCommand, { Key: keys.response("g1", 1, 1, "t2") }).resolves({});
    await expect(gradeResponse(gradeArgs({ teamId: "t2" }))).rejects.toThrow(/did not submit/);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("rejects a bad token, unknown question and unknown team", async () => {
    stubGame();
    await expect(gradeResponse(gradeArgs({ gmToken: "wrong" }))).rejects.toThrow(ForbiddenError);
    await expect(gradeResponse(gradeArgs({ questionNumber: 9 }))).rejects.toThrow(NotFoundError);
    await expect(gradeResponse(gradeArgs({ teamId: "nope" }))).rejects.toThrow(NotFoundError);
  });
});

describe("endRound", () => {
  const args = { gameId: "g1", gmToken: GM_TOKEN, roundNumber: 1 };

  function submission(teamId: string, doubled = false): Record<string, unknown> {
    return { ...keys.submission("g1", 1, teamId), teamId, submittedAt: "2026-08-30", doubled };
  }

  const graded = [
    responseItem(1, "t1", { graded: true, gradedPoints: [2], doubled: true }),
    responseItem(2, "t1", { graded: true, gradedPoints: [3], doubled: true }),
    responseItem(1, "t2", { graded: true, gradedPoints: [1] }),
    submission("t1", true),
    submission("t2"),
  ];

  it("adds the entered points to each team's score in one transaction", async () => {
    stubGame({ roundStatus: "GRADING", responses: graded });
    await endRound(args);

    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
    const items = writes();
    expect(items).toHaveLength(4);
    expect(updateAt(0)).toMatchObject({
      Key: keys.team("g1", "t1"),
      UpdateExpression: "SET score = score + :points",
      ExpressionAttributeValues: { ":points": 5 },
    });
    expect(updateAt(1).ExpressionAttributeValues).toMatchObject({ ":points": 1 });
  });

  it("adds the plain sum for a doubled team, with no multiplication", async () => {
    stubGame({ roundStatus: "GRADING", responses: graded });
    const update = await endRound(args);
    // t1 doubled and was graded 2 + 3; its score moves 10 -> 15, not 10 -> 20.
    expect(update.game.teams.find((team) => team.id === "t1")?.score).toBe(15);
  });

  it("reveals the round and the game in the same transaction", async () => {
    stubGame({ roundStatus: "GRADING", responses: graded });
    const update = await endRound(args);

    expect(updateAt(2)).toMatchObject({
      Key: keys.round("g1", 1),
      ConditionExpression: "#status IN (:active, :grading)",
      ExpressionAttributeValues: { ":revealed": "REVEALED" },
    });
    expect(updateAt(3)).toMatchObject({
      Key: keys.gameMeta("g1"),
      ExpressionAttributeValues: { ":reveal": "REVEAL" },
    });
    expect(update).toMatchObject({ event: "ROUND_REVEALED", status: "REVEAL" });
  });

  it("publishes the answers with the reveal", async () => {
    stubGame({ roundStatus: "GRADING", responses: graded });
    const update = await endRound(args);
    const round = update.game.rounds.find((candidate) => candidate.number === 1);
    expect(round?.status).toBe("REVEALED");
    expect(round?.questions[0].correctAnswers).toEqual(["Answer 1"]);
  });

  it("does not write a team that scored nothing, and is not blocked by it", async () => {
    stubGame({
      roundStatus: "GRADING",
      responses: [
        responseItem(1, "t1", { graded: true, gradedPoints: [2] }),
        submission("t1"),
        submission("t2"),
      ],
    });
    const update = await endRound(args);

    const items = writes();
    expect(items).toHaveLength(3);
    expect(updateAt(0).Key).toEqual(keys.team("g1", "t1"));
    expect(update.game.teams.find((team) => team.id === "t2")?.score).toBe(4);
  });

  it("refuses to end a round with an outstanding team", async () => {
    stubGame({
      roundStatus: "GRADING",
      responses: [
        responseItem(1, "t1", { graded: true, gradedPoints: [2] }),
        submission("t1"),
      ],
    });
    await expect(endRound(args)).rejects.toThrow(/Hawks .* not submitted/);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("refuses a round with no submissions at all", async () => {
    stubGame({ responses: [] });
    await expect(endRound(args)).rejects.toThrow(ConflictError);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("ignores ungraded responses when summing", async () => {
    stubGame({
      roundStatus: "GRADING",
      responses: [
        responseItem(1, "t1", { graded: true, gradedPoints: [2] }),
        responseItem(2, "t1"),
        submission("t1"),
        submission("t2"),
      ],
    });
    const update = await endRound(args);
    expect(update.game.teams.find((team) => team.id === "t1")?.score).toBe(12);
  });

  it("refuses a round already revealed, and a bad token", async () => {
    stubGame({ roundStatus: "REVEALED" });
    await expect(endRound(args)).rejects.toThrow(/already been revealed/);
    stubGame();
    await expect(endRound({ ...args, gmToken: "wrong" })).rejects.toThrow(ForbiddenError);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe("roundResults", () => {
  const submitted = [responseItem(1, "t1", { graded: true, gradedPoints: [2] })];

  it("refuses a player before the reveal", async () => {
    stubGame({ roundStatus: "GRADING", responses: submitted });
    await expect(roundResults({ gameId: "g1", roundNumber: 1 })).rejects.toThrow(ForbiddenError);
  });

  it("serves the GM before the reveal, with the answer key", async () => {
    stubGame({ roundStatus: "GRADING", responses: submitted });
    const result = await roundResults({ gameId: "g1", roundNumber: 1, gmToken: GM_TOKEN });

    expect(result?.round.questions[0].correctAnswers).toEqual(["Answer 1"]);
    expect(result?.responses).toHaveLength(1);
    expect(result?.responses[0]).toMatchObject({ teamId: "t1", gradedPoints: [2] });
  });

  it("treats a wrong token as a player", async () => {
    stubGame({ roundStatus: "GRADING", responses: submitted });
    await expect(
      roundResults({ gameId: "g1", roundNumber: 1, gmToken: "wrong" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("is public once the round is revealed, and carries the answers", async () => {
    stubGame({ gameStatus: "REVEAL", roundStatus: "REVEALED", responses: submitted });
    const result = await roundResults({ gameId: "g1", roundNumber: 1 });
    expect(result?.round.questions[0].correctAnswers).toEqual(["Answer 1"]);
    expect(result?.standings.map((team) => team.id)).toEqual(["t1", "t2"]);
  });

  it("excludes the submission markers from the responses", async () => {
    stubGame({
      gameStatus: "REVEAL",
      roundStatus: "REVEALED",
      responses: [
        ...submitted,
        { ...keys.submission("g1", 1, "t1"), teamId: "t1", submittedAt: "2026-08-30", doubled: false },
      ],
    });
    const result = await roundResults({ gameId: "g1", roundNumber: 1 });
    expect(result?.responses).toHaveLength(1);
    expect(result?.responses[0].questionNumber).toBe(1);
  });

  it("errors for an unknown game and returns null for a round not yet created", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(roundResults({ gameId: "nope", roundNumber: 1 })).rejects.toThrow(NotFoundError);
    stubGame();
    expect(await roundResults({ gameId: "g1", roundNumber: 9 })).toBeNull();
  });
});

describe("standings", () => {
  it("ranks teams by score, highest first", async () => {
    stubGame();
    const table = await standings({ gameId: "g1" });
    expect(table.map((team) => [team.id, team.score])).toEqual([
      ["t1", 10],
      ["t2", 4],
    ]);
  });

  it("breaks a tie by name so the order is stable", async () => {
    stubGame({
      teams: [
        { ...keys.team("g1", "t1"), name: "Owls", score: 5, doubleUsedRound: null },
        { ...keys.team("g1", "t2"), name: "Hawks", score: 5, doubleUsedRound: null },
      ],
    });
    const table = await standings({ gameId: "g1" });
    expect(table.map((team) => team.name)).toEqual(["Hawks", "Owls"]);
  });

  it("carries each team's roster", async () => {
    stubGame();
    const table = await standings({ gameId: "g1" });
    expect(table[0].players.map((player) => player.id)).toEqual(["p1"]);
  });

  it("errors for an unknown game", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(standings({ gameId: "nope" })).rejects.toThrow(NotFoundError);
  });
});
