import type { TeamResponse } from "@know-it-owl/core";
import { expectedAnswerCount } from "../lib/answerInput.js";
import { requiredInt, requiredObject, requiredString } from "../lib/args.js";
import { cancellationCodes, getItem, tableName, transactWrite } from "../lib/db.js";
import { ConflictError, NotFoundError, ValidationError } from "../lib/errors.js";
import { loadGameState } from "../lib/gameState.js";
import { assertGm } from "../lib/gmAuth.js";
import * as keys from "../lib/keys.js";
import { toTeamResponse } from "../lib/mappers.js";

const CONDITION_FAILED = "ConditionalCheckFailed";

/** Rounds whose responses may still be graded. */
const GRADABLE = new Set(["ACTIVE", "GRADING"]);

/**
 * Read the `points` argument. Length has to match what the question asked for —
 * one entry per TEXT answer, ten for a PICTURE_10 — but the values themselves
 * are the GM's to decide and are stored as entered.
 */
function readPoints(value: unknown, expected: number): number[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('"points" must be an array of integers');
  }
  const points = value.map((entry) => {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0) {
      throw new ValidationError('"points" must contain only non-negative integers');
    }
    return entry;
  });
  if (points.length !== expected) {
    throw new ValidationError(
      `This question needs exactly ${expected} point value${expected === 1 ? "" : "s"}, got ${points.length}`,
    );
  }
  return points;
}

/**
 * Record the points a team earned for one question.
 *
 * The response update and the round's move into GRADING go in one transaction,
 * so a round can never show as graded without the grade that caused it. Both
 * writes are idempotent: re-grading a question overwrites the points, and a
 * round already in GRADING stays there.
 */
export async function gradeResponse(args: Record<string, unknown>): Promise<TeamResponse> {
  const input = requiredObject(args, "input");
  const gameId = requiredString(input, "gameId");
  const gmToken = requiredString(input, "gmToken");
  const roundNumber = requiredInt(input, "roundNumber", { min: 1 });
  const questionNumber = requiredInt(input, "questionNumber", { min: 1 });
  const teamId = requiredString(input, "teamId");

  const state = await loadGameState(gameId);
  if (!state) throw new NotFoundError("No such game");
  assertGm(gmToken, state.gmTokenHash);

  const round = state.rounds.find((candidate) => candidate.number === roundNumber);
  if (!round) throw new NotFoundError(`No round ${roundNumber} in this game`);
  if (!GRADABLE.has(round.status)) {
    throw new ConflictError(
      round.status === "REVEALED"
        ? `Round ${roundNumber} has already been revealed`
        : `Round ${roundNumber} has not started`,
    );
  }

  const question = state.questions.find(
    (candidate) => candidate.roundNumber === roundNumber && candidate.number === questionNumber,
  );
  if (!question) {
    throw new NotFoundError(`Round ${roundNumber} has no question ${questionNumber}`);
  }
  if (!state.teams.some((candidate) => candidate.id === teamId)) {
    throw new NotFoundError("No such team in this game");
  }

  const points = readPoints(input.points, expectedAnswerCount(question));

  const responseKey = keys.response(gameId, roundNumber, questionNumber, teamId);
  const existingItem = await getItem(responseKey);
  if (!existingItem) {
    throw new NotFoundError(`Team ${teamId} did not submit question ${questionNumber}`);
  }
  const existing = toTeamResponse(existingItem);

  const table = tableName();
  try {
    await transactWrite([
      {
        Update: {
          TableName: table,
          Key: responseKey,
          UpdateExpression: "SET gradedPoints = :points, graded = :graded",
          // A team that never submitted has nothing to grade.
          ConditionExpression: "attribute_exists(sk)",
          ExpressionAttributeValues: { ":points": points, ":graded": true },
        },
      },
      {
        Update: {
          TableName: table,
          Key: keys.round(gameId, roundNumber),
          UpdateExpression: "SET #status = :grading",
          ConditionExpression: "#status IN (:active, :grading)",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":grading": "GRADING", ":active": "ACTIVE" },
        },
      },
    ]);
  } catch (error) {
    const [missingResponse, roundMoved] = cancellationCodes(error);
    if (missingResponse === CONDITION_FAILED) {
      throw new NotFoundError(`Team ${teamId} did not submit question ${questionNumber}`);
    }
    if (roundMoved === CONDITION_FAILED) {
      throw new ConflictError(`Round ${roundNumber} is no longer being graded`);
    }
    throw error;
  }

  return { ...existing, graded: true, gradedPoints: points };
}
