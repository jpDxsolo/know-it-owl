import { requiredInt, requiredString } from "../lib/args.js";
import { isConditionFailure, updateItem } from "../lib/db.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { loadGameState, snapshot } from "../lib/gameState.js";
import { assertGm } from "../lib/gmAuth.js";
import * as keys from "../lib/keys.js";
import { gameUpdate, type GameUpdate } from "../lib/views.js";

/**
 * Unveil the next question in the active round.
 *
 * Advancement is strictly sequential and enforced by the database, not by the
 * check above it: the update only applies when `releasedCount` still equals
 * `questionNumber - 1`. Two GM devices tapping "next" at once therefore produce
 * one advance and one CONFLICT, rather than skipping a question.
 */
export async function releaseQuestion(args: Record<string, unknown>): Promise<GameUpdate> {
  const gameId = requiredString(args, "gameId");
  const gmToken = requiredString(args, "gmToken");
  const roundNumber = requiredInt(args, "roundNumber", { min: 1 });
  const questionNumber = requiredInt(args, "questionNumber", { min: 1 });

  const state = await loadGameState(gameId);
  if (!state) throw new NotFoundError("No such game");
  assertGm(gmToken, state.gmTokenHash);

  const round = state.rounds.find((candidate) => candidate.number === roundNumber);
  if (!round) throw new NotFoundError(`No round ${roundNumber} in this game`);
  if (round.status !== "ACTIVE") {
    throw new ConflictError(`Round ${roundNumber} is not in play`);
  }

  const questionCount = state.questions.filter(
    (question) => question.roundNumber === roundNumber,
  ).length;
  if (questionNumber > questionCount) {
    throw new NotFoundError(`Round ${roundNumber} has no question ${questionNumber}`);
  }

  try {
    await updateItem(keys.round(gameId, roundNumber), {
      updateExpression: "SET releasedCount = :next",
      // The whole point: no skipping, and no lost update under a double tap.
      conditionExpression: "releasedCount = :previous",
      values: { ":next": questionNumber, ":previous": questionNumber - 1 },
    });
  } catch (error) {
    if (isConditionFailure(error)) {
      throw new ConflictError(
        `Question ${questionNumber} is not next in round ${roundNumber} (released ${round.releasedCount})`,
      );
    }
    throw error;
  }

  const released = { ...round, releasedCount: questionNumber };
  const view = await snapshot(
    {
      ...state,
      rounds: state.rounds.map((candidate) =>
        candidate.number === roundNumber ? released : candidate,
      ),
    },
    "PLAYER",
  );
  return gameUpdate(view, "QUESTION_RELEASED");
}
