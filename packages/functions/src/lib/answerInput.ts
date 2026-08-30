/**
 * Validation for the answers a team submits for a round.
 *
 * A submission is all-or-nothing, so coverage is checked here before anything
 * is written: exactly one entry per question in the round, each carrying the
 * number of strings that question's type calls for.
 */
import type { Question } from "@know-it-owl/core";
import { ValidationError } from "./errors.js";
import { PICTURE_10_ANSWER_COUNT } from "./questionInput.js";

export interface ParsedAnswers {
  questionNumber: number;
  answers: string[];
}

/** One string for a TEXT question; ten for the ten items of a PICTURE_10. */
export function expectedAnswerCount(question: Question): number {
  return question.type === "PICTURE_10" ? PICTURE_10_ANSWER_COUNT : 1;
}

function readEntry(raw: unknown, index: number): ParsedAnswers {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError(`answers[${index}]: must be an object`);
  }
  const entry = raw as Record<string, unknown>;

  const questionNumber = entry.questionNumber;
  if (typeof questionNumber !== "number" || !Number.isInteger(questionNumber)) {
    throw new ValidationError(`answers[${index}]: "questionNumber" must be an integer`);
  }
  if (!Array.isArray(entry.answers)) {
    throw new ValidationError(`answers[${index}]: "answers" must be an array of strings`);
  }
  const answers = entry.answers.map((answer) => {
    if (typeof answer !== "string") {
      throw new ValidationError(`answers[${index}]: "answers" must be an array of strings`);
    }
    // Blanks are kept: a team that does not know an answer still submits, and
    // the grader decides what an empty answer is worth.
    return answer.trim();
  });

  return { questionNumber, answers };
}

/**
 * Validate the whole `answers` argument against the round's questions, and
 * return it ordered by question number.
 */
export function parseAnswerInputs(value: unknown, questions: Question[]): ParsedAnswers[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('"answers" must be an array');
  }

  const entries = value.map(readEntry);
  const byNumber = new Map<number, ParsedAnswers>();
  for (const entry of entries) {
    if (byNumber.has(entry.questionNumber)) {
      throw new ValidationError(`Question ${entry.questionNumber} was answered twice`);
    }
    byNumber.set(entry.questionNumber, entry);
  }

  for (const question of questions) {
    const entry = byNumber.get(question.number);
    if (!entry) {
      throw new ValidationError(`Question ${question.number} has no answer`);
    }
    const expected = expectedAnswerCount(question);
    if (entry.answers.length !== expected) {
      throw new ValidationError(
        `Question ${question.number} needs exactly ${expected} answer${expected === 1 ? "" : "s"}, got ${entry.answers.length}`,
      );
    }
    byNumber.delete(question.number);
  }

  const [extra] = byNumber.keys();
  if (extra !== undefined) {
    throw new ValidationError(`Question ${extra} is not in this round`);
  }

  return questions.map((question) => ({
    questionNumber: question.number,
    answers: entries.find((entry) => entry.questionNumber === question.number)?.answers ?? [],
  }));
}
