/**
 * A quiz as a file: written once, opened whenever you want to play it.
 *
 * Rounds used to exist only inside the game they were written for, which meant
 * writing them on the night. A quiz file is the same rounds, detached — export
 * it from a game, keep it wherever you keep things, and open it into a new game
 * later. There is no storage and no account behind it, so there is nothing to
 * own, nothing to log into and nothing to lose but the file.
 *
 * **A file is untrusted input.** It arrives from a disk, possibly hand-edited,
 * possibly written by a different version of this app, possibly not a quiz at
 * all. Everything below is written to say no clearly rather than to let a
 * malformed round through and fail halfway into creating it.
 */

import type { Game } from "../hooks/useGame";
import type { QuestionInput, QuestionType } from "../gql/graphql";

/** A PICTURE_10 is ten numbered things in one image, so it takes ten answers. */
const PICTURE_ANSWER_COUNT = 10;

/**
 * Bumped only if the shape changes incompatibly. A file without it is not one
 * of ours, and a file from the future is not something this version can read
 * correctly — better to refuse than to guess.
 */
export const QUIZ_FILE_VERSION = 1;

export interface QuizFileQuestion {
  type: QuestionType;
  text?: string;
  /**
   * Where the picture is stored, carried across games deliberately.
   *
   * The image itself stays in the game it was uploaded to, and this points at
   * it. Nothing scopes reads by game, so it works — but a quiz file outlives
   * the game that made it, and if those objects are ever cleaned up the round
   * will open with a missing picture.
   */
  imageKey?: string;
  correctAnswers: string[];
  defaultPoints: number;
}

export interface QuizFileRound {
  category: string;
  doublingAllowed: boolean;
  questions: QuizFileQuestion[];
}

export interface QuizFile {
  knowItOwlQuiz: number;
  name: string;
  rounds: QuizFileRound[];
}

/** Everything a game's rounds contain that is worth keeping. */
export function toQuizFile(name: string, rounds: Game["rounds"]): QuizFile {
  return {
    knowItOwlQuiz: QUIZ_FILE_VERSION,
    name,
    rounds: rounds.map((round) => ({
      category: round.category,
      doublingAllowed: round.doublingAllowed,
      questions: round.questions.map((question) => ({
        type: question.type,
        ...(question.text ? { text: question.text } : {}),
        ...(question.imageKey ? { imageKey: question.imageKey } : {}),
        correctAnswers: [...(question.correctAnswers ?? [])],
        defaultPoints: question.defaultPoints,
      })),
    })),
  };
}

/** Thrown with a sentence a host can act on, never a parser's own words. */
export class QuizFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuizFileError";
  }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new QuizFileError(`${what} is not in the right shape.`);
  }
  return value as Record<string, unknown>;
}

function readQuestion(raw: unknown, round: number, index: number): QuizFileQuestion {
  const where = `Round ${round}, question ${index + 1}`;
  const question = asRecord(raw, where);

  const type = question.type;
  if (type !== "TEXT" && type !== "PICTURE_10") {
    throw new QuizFileError(`${where} has an unknown type.`);
  }

  const answers = question.correctAnswers;
  if (!Array.isArray(answers) || answers.some((answer) => typeof answer !== "string")) {
    throw new QuizFileError(`${where} has no answers.`);
  }

  const points = question.defaultPoints;
  if (typeof points !== "number" || !Number.isInteger(points) || points < 1) {
    throw new QuizFileError(`${where} has an invalid points value.`);
  }

  if (type === "TEXT") {
    if (typeof question.text !== "string" || question.text.trim().length === 0) {
      throw new QuizFileError(`${where} has no question text.`);
    }
    if (answers.length === 0) {
      throw new QuizFileError(`${where} has no answers.`);
    }
    return {
      type,
      text: question.text,
      correctAnswers: answers as string[],
      defaultPoints: points,
    };
  }

  if (typeof question.imageKey !== "string" || question.imageKey.length === 0) {
    throw new QuizFileError(`${where} is a picture round with no picture.`);
  }
  if (answers.length !== PICTURE_ANSWER_COUNT) {
    throw new QuizFileError(
      `${where} is a picture round and needs exactly ${PICTURE_ANSWER_COUNT} answers.`,
    );
  }
  return {
    type,
    imageKey: question.imageKey,
    correctAnswers: answers as string[],
    defaultPoints: points,
  };
}

/**
 * Read a file's contents into a quiz, or throw something worth showing a host.
 */
export function parseQuizFile(contents: string): QuizFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new QuizFileError("That file isn't a quiz — it isn't even JSON.");
  }

  const file = asRecord(parsed, "That file");
  const version = file.knowItOwlQuiz;
  if (typeof version !== "number") {
    throw new QuizFileError("That file wasn't written by Know It Owl.");
  }
  if (version > QUIZ_FILE_VERSION) {
    throw new QuizFileError(
      "That quiz was written by a newer version of Know It Owl than this one.",
    );
  }

  const rounds = file.rounds;
  if (!Array.isArray(rounds) || rounds.length === 0) {
    throw new QuizFileError("That quiz has no rounds in it.");
  }

  return {
    knowItOwlQuiz: QUIZ_FILE_VERSION,
    name: typeof file.name === "string" && file.name.trim() ? file.name : "Quiz",
    rounds: rounds.map((raw, index) => {
      const number = index + 1;
      const round = asRecord(raw, `Round ${number}`);
      if (typeof round.category !== "string" || round.category.trim().length === 0) {
        throw new QuizFileError(`Round ${number} has no category.`);
      }
      const questions = round.questions;
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new QuizFileError(`Round ${number} has no questions.`);
      }
      return {
        category: round.category,
        // Absent means allowed, exactly as the server reads it.
        doublingAllowed: round.doublingAllowed !== false,
        questions: questions.map((question, at) => readQuestion(question, number, at)),
      };
    }),
  };
}

/** One round's questions in the shape `createRound` takes. */
export function toQuestionInputs(round: QuizFileRound): QuestionInput[] {
  return round.questions.map((question) =>
    question.type === "TEXT"
      ? {
          type: "TEXT" as const,
          text: question.text ?? "",
          correctAnswers: question.correctAnswers,
          defaultPoints: question.defaultPoints,
        }
      : {
          type: "PICTURE_10" as const,
          imageKey: question.imageKey ?? "",
          correctAnswers: question.correctAnswers,
          defaultPoints: question.defaultPoints,
        },
  );
}

/** A filename that sorts well and says what it is. */
export function quizFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "quiz"}.kio.json`;
}
