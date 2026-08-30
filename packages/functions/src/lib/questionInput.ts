/**
 * Validation for the `QuestionInput` values a GM submits when authoring a round.
 *
 * These arrive as `unknown` from AppSync and are the only place a correct-answer
 * key enters the system, so every field is checked here rather than trusted.
 */
import type { Question, QuestionType } from "@know-it-owl/core";
import { ValidationError } from "./errors.js";

/** A PICTURE_10 question is ten items on one image, so it needs exactly ten answers. */
export const PICTURE_10_ANSWER_COUNT = 10;

/**
 * DynamoDB caps a transaction at 100 items, and the binding constraint is
 * submission, not authoring: a team writes one response per question, plus its
 * submission marker, plus the optional double flag. Authoring a round the teams
 * could not then submit would be a trap, so the tighter limit governs both.
 */
export const MAX_QUESTIONS_PER_ROUND = 98;

export type ParsedQuestion = Omit<Question, "roundNumber" | "number">;

function fail(index: number, message: string): never {
  throw new ValidationError(`questions[${index}]: ${message}`);
}

function optionalTrimmed(value: unknown, index: number, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") fail(index, `"${field}" must be a string`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function answerKey(value: unknown, index: number): string[] {
  if (!Array.isArray(value)) fail(index, '"correctAnswers" must be an array of strings');
  const answers = value.map((entry) => {
    if (typeof entry !== "string") fail(index, '"correctAnswers" must be an array of strings');
    return entry.trim();
  });
  if (answers.some((answer) => answer.length === 0)) {
    fail(index, '"correctAnswers" must not contain empty strings');
  }
  return answers;
}

function points(value: unknown, index: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(index, '"defaultPoints" must be a positive integer');
  }
  return value;
}

function parseOne(raw: unknown, index: number): ParsedQuestion {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(index, "must be an object");
  }
  const input = raw as Record<string, unknown>;

  const type = input.type;
  if (type !== "TEXT" && type !== "PICTURE_10") {
    fail(index, '"type" must be TEXT or PICTURE_10');
  }
  const text = optionalTrimmed(input.text, index, "text");
  const imageKey = optionalTrimmed(input.imageKey, index, "imageKey");
  const correctAnswers = answerKey(input.correctAnswers, index);
  const defaultPoints = points(input.defaultPoints, index);

  if (type === "TEXT") {
    if (text === undefined) fail(index, "a TEXT question needs non-empty text");
    if (imageKey !== undefined) fail(index, "a TEXT question must not carry an imageKey");
    if (correctAnswers.length === 0) {
      fail(index, "a TEXT question needs at least one correct answer");
    }
  } else {
    if (imageKey === undefined) fail(index, "a PICTURE_10 question needs an imageKey");
    if (correctAnswers.length !== PICTURE_10_ANSWER_COUNT) {
      fail(
        index,
        `a PICTURE_10 question needs exactly ${PICTURE_10_ANSWER_COUNT} correct answers, got ${correctAnswers.length}`,
      );
    }
  }

  const questionType: QuestionType = type;
  return {
    type: questionType,
    ...(text !== undefined ? { text } : {}),
    ...(imageKey !== undefined ? { imageKey } : {}),
    correctAnswers,
    defaultPoints,
  };
}

/** Validate the whole `questions` argument, or throw naming the offending index. */
export function parseQuestionInputs(value: unknown, maxQuestions: number): ParsedQuestion[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('"questions" must be an array');
  }
  if (value.length === 0) {
    throw new ValidationError("A round needs at least one question");
  }
  if (value.length > maxQuestions) {
    throw new ValidationError(`A round may hold at most ${maxQuestions} questions`);
  }
  return value.map(parseOne);
}
