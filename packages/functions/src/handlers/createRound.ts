import type { Question, Round } from "@know-it-owl/core";
import { requiredString } from "../lib/args.js";
import { getItem, queryPrefix, tableName, transactWrite } from "../lib/db.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { assertGm } from "../lib/gmAuth.js";
import * as keys from "../lib/keys.js";
import { isQuestionKey, toRound, type QuestionItem, type RoundItem } from "../lib/mappers.js";
import { MAX_QUESTIONS_PER_ROUND, parseQuestionInputs } from "../lib/questionInput.js";
import { withoutAnswerKeys, type VisibleRound } from "../lib/visibility.js";

const MAX_CATEGORY_LENGTH = 60;

/** A round already in play; a second one would make "the current round" ambiguous. */
const IN_PLAY = new Set(["ACTIVE", "GRADING"]);

/**
 * Author a round as a draft. Nothing is visible to players until `startRound`,
 * and even then only up to `releasedCount`.
 *
 * V1 has no draft editing: a mistake means authoring a new round.
 */
export async function createRound(args: Record<string, unknown>): Promise<VisibleRound> {
  const gameId = requiredString(args, "gameId");
  const gmToken = requiredString(args, "gmToken");
  const category = requiredString(args, "category", { maxLength: MAX_CATEGORY_LENGTH });
  const parsed = parseQuestionInputs(args.questions, MAX_QUESTIONS_PER_ROUND);

  const meta = await getItem(keys.gameMeta(gameId));
  if (!meta) throw new NotFoundError("No such game");
  assertGm(gmToken, typeof meta.gmTokenHash === "string" ? meta.gmTokenHash : undefined);

  const roundItems = await queryPrefix(keys.gamePk(gameId), keys.prefixes.rounds());
  const existing = roundItems.filter((item) => !isQuestionKey(item.sk)).map(toRound);

  if (existing.some((round) => IN_PLAY.has(round.status))) {
    throw new ConflictError("Finish the round in play before authoring another");
  }

  const roundNumber = existing.reduce((highest, round) => Math.max(highest, round.number), 0) + 1;

  const round: Round = {
    number: roundNumber,
    category,
    status: "DRAFT",
    releasedCount: 0,
  };
  const roundItem: RoundItem = {
    ...keys.round(gameId, roundNumber),
    category: round.category,
    status: round.status,
    releasedCount: round.releasedCount,
  };

  const table = tableName();
  const questions: Question[] = [];
  const writes: Parameters<typeof transactWrite>[0] = [
    {
      Put: {
        TableName: table,
        Item: roundItem,
        // Loses to a concurrent createRound that claimed this number first.
        ConditionExpression: "attribute_not_exists(sk)",
      },
    },
  ];

  parsed.forEach((question, index) => {
    const questionNumber = index + 1;
    questions.push({ ...question, roundNumber, number: questionNumber });
    const item: QuestionItem = {
      ...keys.question(gameId, roundNumber, questionNumber),
      type: question.type,
      ...(question.text !== undefined ? { text: question.text } : {}),
      ...(question.imageKey !== undefined ? { imageKey: question.imageKey } : {}),
      correctAnswers: question.correctAnswers,
      defaultPoints: question.defaultPoints,
    };
    writes.push({
      Put: { TableName: table, Item: item, ConditionExpression: "attribute_not_exists(sk)" },
    });
  });

  await transactWrite(writes);

  // The GM gets every question back but no answer keys: one rule, applied to
  // every pre-reveal payload, rather than an exception for the author.
  return withoutAnswerKeys(round, questions);
}
