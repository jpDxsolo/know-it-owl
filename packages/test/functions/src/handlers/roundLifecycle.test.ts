import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRound } from "@know-it-owl/functions/handlers/createRound";
import { getGame } from "@know-it-owl/functions/handlers/getGame";
import { releaseQuestion } from "@know-it-owl/functions/handlers/releaseQuestion";
import { startRound } from "@know-it-owl/functions/handlers/startRound";
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

function meta(status: string, currentRound: number | null = null): Record<string, unknown> {
  return {
    ...keys.gameMeta("g1"),
    status,
    gmTokenHash: hashGmToken(GM_TOKEN),
    joinCode: "ABC234",
    currentRound,
    createdAt: "2026-08-30T00:00:00.000Z",
  };
}

function questionItem(round: number, number: number, answer: string): Record<string, unknown> {
  return {
    ...keys.question("g1", round, number),
    type: "TEXT",
    text: `Q${number}`,
    correctAnswers: [answer],
    defaultPoints: 1,
  };
}

function roundItem(number: number, status: string, releasedCount: number): Record<string, unknown> {
  return { ...keys.round("g1", number), category: "History", status, releasedCount };
}

interface StubOptions {
  status?: string;
  currentRound?: number | null;
  rounds?: Record<string, unknown>[];
}

function stubGame({ status = "TEAMS_SET", currentRound = null, rounds = [] }: StubOptions = {}) {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({ Item: meta(status, currentRound) });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } }).resolves({
    Items: [{ ...keys.player("g1", "p1"), displayName: "Ada", teamId: "t1" }],
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } }).resolves({
    Items: [{ ...keys.team("g1", "t1"), name: "Owls", score: 0, doubleUsedRound: null }],
  });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } })
    .resolves({ Items: rounds });
  ddbMock.on(TransactWriteCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
}

/** A three-question round in the given state. */
function roundWithQuestions(status: string, releasedCount: number): Record<string, unknown>[] {
  return [
    roundItem(1, status, releasedCount),
    questionItem(1, 1, "Paris"),
    questionItem(1, 2, "Rome"),
    questionItem(1, 3, "Oslo"),
  ];
}

function conditionFailure(): Error {
  const error = new Error("The conditional request failed");
  error.name = "ConditionalCheckFailedException";
  return error;
}

const gmArgs = { gameId: "g1", gmToken: GM_TOKEN };

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

const textQuestion = {
  type: "TEXT",
  text: "Capital of France?",
  correctAnswers: ["Paris"],
  defaultPoints: 1,
};

describe("createRound", () => {
  const args = { ...gmArgs, category: "Geography", questions: [textQuestion] };

  it("writes a DRAFT round with releasedCount 0 and its questions in one transaction", async () => {
    stubGame();
    await createRound(args);

    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(2);
    const [round, question] = items.map((entry) => entry.Put?.Item as Record<string, unknown>);
    expect(round).toMatchObject({ sk: "ROUND#1", status: "DRAFT", releasedCount: 0 });
    expect(question).toMatchObject({ sk: "ROUND#1#Q#1", correctAnswers: ["Paris"] });
  });

  it("uses the KIO-01 key formats", async () => {
    stubGame();
    await createRound({ ...args, questions: [textQuestion, textQuestion] });
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];
    expect(items.map((entry) => (entry.Put?.Item as { sk: string }).sk)).toEqual([
      "ROUND#1",
      "ROUND#1#Q#1",
      "ROUND#1#Q#2",
    ]);
  });

  it("returns the round without any answer key", async () => {
    stubGame();
    const round = await createRound(args);
    expect(round).toMatchObject({ number: 1, status: "DRAFT", releasedCount: 0 });
    expect(round.questions[0].correctAnswers).toBeNull();
    expect(JSON.stringify(round)).not.toContain("Paris");
  });

  it("numbers the next round after the highest existing one", async () => {
    stubGame({ rounds: [roundItem(1, "REVEALED", 3), roundItem(2, "REVEALED", 2)] });
    const round = await createRound(args);
    expect(round.number).toBe(3);
  });

  it("refuses to author while a round is in play", async () => {
    for (const status of ["ACTIVE", "GRADING"]) {
      ddbMock.reset();
      stubGame({ rounds: [roundItem(1, status, 1)] });
      await expect(createRound(args)).rejects.toThrow(/round in play/);
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
    }
  });

  it("rejects a caller without a valid GM token", async () => {
    stubGame();
    await expect(createRound({ ...args, gmToken: "wrong" })).rejects.toThrow(ForbiddenError);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("rejects invalid questions before touching the database", async () => {
    stubGame();
    await expect(createRound({ ...args, questions: [] })).rejects.toThrow(ValidationError);
    await expect(
      createRound({ ...args, questions: [{ ...textQuestion, text: "" }] }),
    ).rejects.toThrow(ValidationError);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it("rejects an unknown game", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(createRound(args)).rejects.toThrow(NotFoundError);
  });
});

describe("startRound", () => {
  const args = { ...gmArgs, roundNumber: 1 };

  it("moves the round to ACTIVE with releasedCount 1 and the game to ROUND_ACTIVE", async () => {
    stubGame({ rounds: roundWithQuestions("DRAFT", 0) });
    const update = await startRound(args);

    const updates = (ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [])
      .map((entry) => entry.Update)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
    expect(updates).toHaveLength(2);
    expect(updates[0].ExpressionAttributeValues).toMatchObject({ ":active": "ACTIVE", ":one": 1 });
    expect(updates[0].ConditionExpression).toBe("#status = :draft");
    expect(updates[1].ExpressionAttributeValues).toMatchObject({
      ":active": "ROUND_ACTIVE",
      ":roundNumber": 1,
    });
    expect(update).toMatchObject({ event: "ROUND_STARTED", status: "ROUND_ACTIVE", currentRound: 1 });
  });

  it("releases only the first question to the fan-out payload", async () => {
    stubGame({ rounds: roundWithQuestions("DRAFT", 0) });
    const update = await startRound(args);

    const round = update.game.rounds.find((candidate) => candidate.number === 1);
    expect(round?.releasedCount).toBe(1);
    expect(round?.questions.map((question) => question.number)).toEqual([1]);
    expect(JSON.stringify(update)).not.toContain("Rome");
  });

  it("starts a round from REVEAL as well as TEAMS_SET", async () => {
    stubGame({ status: "REVEAL", rounds: roundWithQuestions("DRAFT", 0) });
    await expect(startRound(args)).resolves.toBeDefined();
  });

  it("refuses to start while another round is in play", async () => {
    stubGame({ status: "ROUND_ACTIVE", rounds: roundWithQuestions("DRAFT", 0) });
    await expect(startRound(args)).rejects.toThrow(/round in play/);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("refuses to restart a round that is not a draft", async () => {
    stubGame({ rounds: roundWithQuestions("ACTIVE", 2) });
    await expect(startRound(args)).rejects.toThrow(/already been started/);
  });

  it("refuses a round with no questions", async () => {
    stubGame({ rounds: [roundItem(1, "DRAFT", 0)] });
    await expect(startRound(args)).rejects.toThrow(/no questions/);
  });

  it("rejects an unknown round and a bad token", async () => {
    stubGame({ rounds: roundWithQuestions("DRAFT", 0) });
    await expect(startRound({ ...args, roundNumber: 9 })).rejects.toThrow(NotFoundError);
    await expect(startRound({ ...args, gmToken: "wrong" })).rejects.toThrow(ForbiddenError);
  });
});

describe("releaseQuestion", () => {
  const args = { ...gmArgs, roundNumber: 1, questionNumber: 2 };

  it("advances the counter under a condition on the previous value", async () => {
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 1) });
    await releaseQuestion(args);

    const input = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.Key).toEqual(keys.round("g1", 1));
    expect(input.ConditionExpression).toBe("releasedCount = :previous");
    expect(input.ExpressionAttributeValues).toMatchObject({ ":next": 2, ":previous": 1 });
  });

  it("returns a QUESTION_RELEASED update carrying the newly released question", async () => {
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 1) });
    const update = await releaseQuestion(args);

    expect(update.event).toBe("QUESTION_RELEASED");
    const round = update.game.rounds.find((candidate) => candidate.number === 1);
    expect(round?.questions.map((question) => question.number)).toEqual([1, 2]);
    // The third question is still the GM's.
    expect(JSON.stringify(update)).not.toContain("Oslo");
  });

  it("never leaks an answer key with the release", async () => {
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 1) });
    const update = await releaseQuestion(args);
    const round = update.game.rounds.find((candidate) => candidate.number === 1);
    expect(round?.questions.every((question) => question.correctAnswers === null)).toBe(true);
    expect(JSON.stringify(update)).not.toContain("Paris");
  });

  it("turns a lost race into a CONFLICT rather than a skip", async () => {
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 1) });
    ddbMock.on(UpdateCommand).rejects(conditionFailure());
    await expect(releaseQuestion(args)).rejects.toThrow(ConflictError);
  });

  it("refuses to skip ahead", async () => {
    // releasedCount is 1, so jumping to 3 asks DynamoDB for releasedCount = 2,
    // which does not hold — the skip is refused by the condition, not by a
    // check in the handler.
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 1) });
    ddbMock.on(UpdateCommand).rejects(conditionFailure());

    await expect(releaseQuestion({ ...args, questionNumber: 3 })).rejects.toThrow(
      /not next in round 1/,
    );
    expect(
      ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues,
    ).toMatchObject({ ":previous": 2 });
  });

  it("propagates an error that is not a condition failure", async () => {
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 1) });
    ddbMock.on(UpdateCommand).rejects(new Error("throttled"));
    await expect(releaseQuestion(args)).rejects.toThrow(/throttled/);
  });

  it("rejects a question the round does not have", async () => {
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 1) });
    await expect(releaseQuestion({ ...args, questionNumber: 4 })).rejects.toThrow(
      /no question 4/,
    );
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("refuses a round that is not in play", async () => {
    stubGame({ rounds: roundWithQuestions("DRAFT", 0) });
    await expect(releaseQuestion(args)).rejects.toThrow(/not in play/);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("rejects a bad token and a bad round", async () => {
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 1) });
    await expect(releaseQuestion({ ...args, gmToken: "wrong" })).rejects.toThrow(ForbiddenError);
    await expect(releaseQuestion({ ...args, roundNumber: 9 })).rejects.toThrow(NotFoundError);
  });
});

describe("answer-leak surface", () => {
  it("hands a player only the released questions, and no keys", async () => {
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 2) });
    const game = await getGame({ gameId: "g1" });

    const round = game?.rounds.find((candidate) => candidate.number === 1);
    expect(round?.questions.map((question) => question.number)).toEqual([1, 2]);
    expect(round?.questions.every((question) => question.correctAnswers === null)).toBe(true);
    expect(JSON.stringify(game)).not.toContain("Oslo");
    expect(JSON.stringify(game)).not.toContain("Paris");
  });

  it("hands the GM every question and every key", async () => {
    stubGame({ status: "ROUND_ACTIVE", currentRound: 1, rounds: roundWithQuestions("ACTIVE", 2) });
    const game = await getGame({ gameId: "g1", gmToken: GM_TOKEN });

    const round = game?.rounds.find((candidate) => candidate.number === 1);
    expect(round?.questions.map((question) => question.number)).toEqual([1, 2, 3]);
    expect(round?.questions[0].correctAnswers).toEqual(["Paris"]);
  });

  it("opens everything to players once the round is revealed", async () => {
    stubGame({ status: "REVEAL", currentRound: 1, rounds: roundWithQuestions("REVEALED", 3) });
    const game = await getGame({ gameId: "g1" });

    const round = game?.rounds.find((candidate) => candidate.number === 1);
    expect(round?.questions.map((question) => question.number)).toEqual([1, 2, 3]);
    expect(round?.questions[2].correctAnswers).toEqual(["Oslo"]);
  });

  it("keeps a draft round entirely hidden from players", async () => {
    stubGame({ rounds: roundWithQuestions("DRAFT", 0) });
    const game = await getGame({ gameId: "g1" });
    expect(game?.rounds).toHaveLength(0);
  });
});
