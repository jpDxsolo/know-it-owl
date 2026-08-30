import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { chooseDouble } from "@know-it-owl/functions/handlers/chooseDouble";
import { submitAnswers } from "@know-it-owl/functions/handlers/submitAnswers";
import { setClient } from "@know-it-owl/functions/lib/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@know-it-owl/functions/lib/errors";
import * as keys from "@know-it-owl/functions/lib/keys";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;

function questionItem(number: number, type = "TEXT"): Record<string, unknown> {
  return {
    ...keys.question("g1", 1, number),
    type,
    ...(type === "TEXT" ? { text: `Q${number}` } : { imageKey: "images/g1/birds.png" }),
    correctAnswers:
      type === "TEXT" ? ["Paris"] : Array.from({ length: 10 }, (_, i) => `Bird ${i + 1}`),
    defaultPoints: type === "TEXT" ? 1 : 10,
  };
}

interface StubOptions {
  roundStatus?: string;
  releasedCount?: number;
  questionCount?: number;
  doubleUsedRound?: number | null;
  playerTeamId?: string | null;
}

function stubGame({
  roundStatus = "ACTIVE",
  releasedCount = 2,
  questionCount = 2,
  doubleUsedRound = null,
  playerTeamId = "t1",
}: StubOptions = {}) {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({
    Item: {
      ...keys.gameMeta("g1"),
      status: "ROUND_ACTIVE",
      gmTokenHash: "deadbeef",
      joinCode: "ABC234",
      currentRound: 1,
      createdAt: "2026-08-30T00:00:00.000Z",
    },
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } }).resolves({
    Items: [{ ...keys.player("g1", "p1"), displayName: "Ada", teamId: playerTeamId }],
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } }).resolves({
    Items: [{ ...keys.team("g1", "t1"), name: "Owls", score: 0, doubleUsedRound }],
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } }).resolves({
    Items: [
      { ...keys.round("g1", 1), category: "History", status: roundStatus, releasedCount },
      ...Array.from({ length: questionCount }, (_, i) => questionItem(i + 1)),
    ],
  });
  ddbMock.on(TransactWriteCommand).resolves({});
}

/** A TransactionCanceledException whose reason codes mirror the items sent. */
function cancelled(codes: (string | undefined)[]): Error {
  const error = new Error("Transaction cancelled, please refer cancellation reasons");
  error.name = "TransactionCanceledException";
  Object.assign(error, {
    CancellationReasons: codes.map((code) => (code ? { Code: code } : { Code: "None" })),
  });
  return error;
}

function writes(): Record<string, unknown>[] {
  return (ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ??
    []) as Record<string, unknown>[];
}

/** The items a transaction puts, in order, ignoring the updates alongside them. */
function putItems(): Record<string, unknown>[] {
  return writes()
    .filter((item) => "Put" in item)
    .map((item) => (item as { Put: { Item: Record<string, unknown> } }).Put.Item);
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

const doubleArgs = { gameId: "g1", playerId: "p1", roundNumber: 1 };

const answers = [
  { questionNumber: 1, answers: ["Paris"] },
  { questionNumber: 2, answers: ["Rome"] },
];

function submitArgs(overrides: Record<string, unknown> = {}) {
  return { input: { gameId: "g1", playerId: "p1", roundNumber: 1, answers, ...overrides } };
}

describe("chooseDouble", () => {
  it("guards on both the submission marker and the unused double", async () => {
    stubGame();
    await chooseDouble(doubleArgs);

    const [check, update] = writes() as [
      { ConditionCheck: Record<string, unknown> },
      { Update: Record<string, unknown> },
    ];
    expect(check.ConditionCheck.Key).toEqual(keys.submission("g1", 1, "t1"));
    expect(check.ConditionCheck.ConditionExpression).toBe("attribute_not_exists(sk)");
    expect(update.Update.Key).toEqual(keys.team("g1", "t1"));
    expect(update.Update.ConditionExpression).toBe(
      "attribute_not_exists(doubleUsedRound) OR doubleUsedRound = :unused",
    );
    expect(update.Update.ExpressionAttributeValues).toMatchObject({ ":roundNumber": 1 });
  });

  it("returns a DOUBLE_CHOSEN update with the flag applied", async () => {
    stubGame();
    const update = await chooseDouble(doubleArgs);
    expect(update.event).toBe("DOUBLE_CHOSEN");
    expect(update.game.teams[0].doubleUsedRound).toBe(1);
  });

  it("reports a lost race against a submission", async () => {
    stubGame();
    ddbMock.on(TransactWriteCommand).rejects(cancelled(["ConditionalCheckFailed", undefined]));
    await expect(chooseDouble(doubleArgs)).rejects.toThrow(/already submitted this round/);
  });

  it("reports a double already spent on another round", async () => {
    stubGame({ doubleUsedRound: 3 });
    ddbMock.on(TransactWriteCommand).rejects(cancelled([undefined, "ConditionalCheckFailed"]));
    await expect(chooseDouble(doubleArgs)).rejects.toThrow(/already used its double on round 3/);
  });

  it("reports a double already taken this round by a teammate", async () => {
    stubGame({ doubleUsedRound: 1 });
    ddbMock.on(TransactWriteCommand).rejects(cancelled([undefined, "ConditionalCheckFailed"]));
    await expect(chooseDouble(doubleArgs)).rejects.toThrow(/already doubled this round/);
  });

  it("propagates an error that is not a cancelled transaction", async () => {
    stubGame();
    ddbMock.on(TransactWriteCommand).rejects(new Error("throttled"));
    await expect(chooseDouble(doubleArgs)).rejects.toThrow(/throttled/);
  });

  it("refuses a round that is not in play", async () => {
    stubGame({ roundStatus: "GRADING" });
    await expect(chooseDouble(doubleArgs)).rejects.toThrow(/not in play/);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("refuses a player with no team", async () => {
    stubGame({ playerTeamId: null });
    await expect(chooseDouble(doubleArgs)).rejects.toThrow(ConflictError);
  });

  it("rejects an unknown player, round and game", async () => {
    stubGame();
    await expect(chooseDouble({ ...doubleArgs, playerId: "nope" })).rejects.toThrow(NotFoundError);
    await expect(chooseDouble({ ...doubleArgs, roundNumber: 9 })).rejects.toThrow(NotFoundError);
    ddbMock.on(GetCommand).resolves({});
    await expect(chooseDouble(doubleArgs)).rejects.toThrow(NotFoundError);
  });
});

describe("submitAnswers", () => {
  it("writes one response per question plus the marker, in one transaction", async () => {
    stubGame();
    await submitAnswers(submitArgs());

    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
    const items = writes();
    // Two answers, the marker, and the team's own record of having handed in.
    expect(items).toHaveLength(4);
    const puts = putItems();
    expect(puts.map((item) => item.sk)).toEqual([
      "RESP#1#1#TEAM#t1",
      "RESP#1#2#TEAM#t1",
      "RESP#1#SUBMIT#TEAM#t1",
    ]);
    expect(puts[0]).toMatchObject({ answers: ["Paris"], doubled: false, graded: false, gradedPoints: null });
  });

  it("guards the marker with attribute_not_exists and the answers without it", async () => {
    stubGame();
    await submitAnswers(submitArgs());
    const conditions = writes()
      .filter((item) => "Put" in item)
      .map((item) => (item as { Put: { ConditionExpression?: string } }).Put.ConditionExpression);
    expect(conditions).toEqual([undefined, undefined, "attribute_not_exists(sk)"]);
  });

  it("stamps the round on the team, so a teammate's phone knows they are in", async () => {
    // The other member never pressed submit and may not read the round's
    // responses, so the lock has to arrive on the team item every snapshot
    // already carries.
    stubGame();
    await submitAnswers(submitArgs());
    const update = (writes()[3] as { Update: Record<string, unknown> }).Update;
    expect(update.Key).toEqual(keys.team("g1", "t1"));
    expect(update.UpdateExpression).toBe("SET lastSubmittedRound = :roundNumber");
    expect(update.ExpressionAttributeValues).toEqual({ ":roundNumber": 1 });
  });

  it("records who submitted and when", async () => {
    stubGame();
    await submitAnswers(submitArgs());
    const marker = (writes()[2] as { Put: { Item: Record<string, unknown> } }).Put.Item;
    expect(marker).toMatchObject({ teamId: "t1", doubled: false });
    expect(typeof marker.submittedAt).toBe("string");
  });

  it("returns an ANSWERS_SUBMITTED update", async () => {
    stubGame();
    const update = await submitAnswers(submitArgs());
    expect(update.event).toBe("ANSWERS_SUBMITTED");
  });

  it("refuses to accept answers before every question is released", async () => {
    stubGame({ releasedCount: 1, questionCount: 2 });
    await expect(submitAnswers(submitArgs())).rejects.toThrow(/unreleased questions \(1 of 2\)/);
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("reports a second submission as a conflict", async () => {
    stubGame();
    ddbMock
      .on(TransactWriteCommand)
      .rejects(cancelled([undefined, undefined, "ConditionalCheckFailed"]));
    await expect(submitAnswers(submitArgs())).rejects.toThrow(/already submitted this round/);
  });

  it("rejects incomplete answer coverage before writing", async () => {
    stubGame();
    await expect(submitAnswers(submitArgs({ answers: [answers[0]] }))).rejects.toThrow(
      /Question 2 has no answer/,
    );
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("refuses a round that is not in play, and an unknown round", async () => {
    stubGame({ roundStatus: "DRAFT", releasedCount: 0 });
    await expect(submitAnswers(submitArgs())).rejects.toThrow(/not in play/);
    stubGame();
    await expect(submitAnswers(submitArgs({ roundNumber: 9 }))).rejects.toThrow(NotFoundError);
  });

  it("rejects a malformed input object", async () => {
    stubGame();
    await expect(submitAnswers({})).rejects.toThrow(ValidationError);
    await expect(submitAnswers({ input: "nope" })).rejects.toThrow(/must be an object/);
  });
});

describe("submitAnswers with a double", () => {
  it("carries the double flag in the same transaction as the answers", async () => {
    stubGame();
    await submitAnswers(submitArgs({ double: true }));

    const items = writes();
    expect(items).toHaveLength(4);
    // One update for the team, not two — a transaction may not touch an item twice.
    const update = (items[3] as { Update: Record<string, unknown> }).Update;
    expect(update.Key).toEqual(keys.team("g1", "t1"));
    expect(update.UpdateExpression).toBe(
      "SET lastSubmittedRound = :roundNumber, doubleUsedRound = :roundNumber",
    );
    expect(update.ConditionExpression).toBe(
      "attribute_not_exists(doubleUsedRound) OR doubleUsedRound = :unused",
    );
  });

  it("marks every response and the marker as doubled", async () => {
    stubGame();
    await submitAnswers(submitArgs({ double: true }));
    expect(putItems().every((item) => item.doubled === true)).toBe(true);
  });

  it("persists no answers when the double loses its race", async () => {
    stubGame();
    ddbMock
      .on(TransactWriteCommand)
      .rejects(cancelled([undefined, undefined, undefined, "ConditionalCheckFailed"]));

    await expect(submitAnswers(submitArgs({ double: true }))).rejects.toThrow(ConflictError);
    // One transaction, cancelled as a whole: nothing was written.
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
  });

  it("rejects a double when one was already spent on another round", async () => {
    stubGame({ doubleUsedRound: 3 });
    await expect(submitAnswers(submitArgs({ double: true }))).rejects.toThrow(
      /already used its double on round 3/,
    );
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });

  it("does not rewrite a double already chosen for this round", async () => {
    stubGame({ doubleUsedRound: 1 });
    await submitAnswers(submitArgs({ double: true }));

    const items = writes();
    expect(items).toHaveLength(4);
    // Nothing to write for the double: only the hand-in is news.
    const update = (items[3] as { Update: Record<string, unknown> }).Update;
    expect(update.UpdateExpression).toBe("SET lastSubmittedRound = :roundNumber");
  });

  it("marks answers doubled when chooseDouble ran earlier, without asking again", async () => {
    stubGame({ doubleUsedRound: 1 });
    await submitAnswers(submitArgs());
    expect(putItems().every((item) => item.doubled === true)).toBe(true);
  });
});
