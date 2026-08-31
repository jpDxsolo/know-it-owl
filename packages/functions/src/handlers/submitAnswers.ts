import { requiredInt, requiredObject, requiredString } from "../lib/args.js";
import { parseAnswerInputs } from "../lib/answerInput.js";
import { cancellationCodes, tableName, transactWrite } from "../lib/db.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { loadGameState, snapshot } from "../lib/gameState.js";
import * as keys from "../lib/keys.js";
import type { ResponseItem, SubmissionItem } from "../lib/mappers.js";
import { gameUpdate, type GameUpdate } from "../lib/views.js";
import { callerTeam } from "./chooseDouble.js";

const CONDITION_FAILED = "ConditionalCheckFailed";

function optionalBoolean(args: Record<string, unknown>, name: string): boolean {
  return args[name] === true;
}

/**
 * Hand in a team's answers for a round.
 *
 * One transaction carries every answer, the submission marker and — when the
 * team is doubling on the way in — the double flag. The marker is written under
 * `attribute_not_exists`, which is what makes "one submission per team per
 * round" true rather than merely checked: a second submit, or a double that
 * loses its race, fails the whole transaction and leaves no answers behind.
 */
export async function submitAnswers(args: Record<string, unknown>): Promise<GameUpdate> {
  const input = requiredObject(args, "input");
  const gameId = requiredString(input, "gameId");
  const playerId = requiredString(input, "playerId");
  const roundNumber = requiredInt(input, "roundNumber", { min: 1 });
  const wantsDouble = optionalBoolean(input, "double");

  const state = await loadGameState(gameId);
  if (!state) throw new NotFoundError("No such game");

  const team = callerTeam(state, playerId);

  const round = state.rounds.find((candidate) => candidate.number === roundNumber);
  if (!round) throw new NotFoundError(`No round ${roundNumber} in this game`);
  if (round.status !== "ACTIVE") {
    throw new ConflictError(`Round ${roundNumber} is not in play`);
  }

  const questions = state.questions.filter((question) => question.roundNumber === roundNumber);
  if (round.releasedCount < questions.length) {
    throw new ConflictError(
      `Round ${roundNumber} still has unreleased questions (${round.releasedCount} of ${questions.length})`,
    );
  }

  const answers = parseAnswerInputs(input.answers, questions);

  // Already doubled this round via chooseDouble: the answers record it, but
  // there is nothing left to write.
  const alreadyDoubledThisRound = team.doubleUsedRound === roundNumber;
  if (wantsDouble && !alreadyDoubledThisRound && team.doubleUsedRound !== null) {
    throw new ConflictError(`Your team already used its double on round ${team.doubleUsedRound}`);
  }
  const doubled = wantsDouble || alreadyDoubledThisRound;
  const writesDouble = wantsDouble && !alreadyDoubledThisRound;

  const table = tableName();
  const writes: Parameters<typeof transactWrite>[0] = answers.map((entry) => {
    const item: ResponseItem = {
      ...keys.response(gameId, roundNumber, entry.questionNumber, team.id),
      answers: entry.answers,
      doubled,
      graded: false,
      gradedPoints: null,
    };
    return { Put: { TableName: table, Item: item } };
  });

  const marker: SubmissionItem = {
    ...keys.submission(gameId, roundNumber, team.id),
    teamId: team.id,
    submittedAt: new Date().toISOString(),
    doubled,
  };
  const markerIndex = writes.length;
  writes.push({
    Put: {
      TableName: table,
      Item: marker,
      // The one submission per team per round guarantee.
      ConditionExpression: "attribute_not_exists(sk)",
    },
  });

  /*
   * One write for the team item, carrying up to two things.
   *
   * `lastSubmittedRound` is how a teammate's phone learns their team is in:
   * they did not press submit, and players may not read the round's responses,
   * so the lock has to arrive on something every snapshot already carries.
   *
   * The double rides along in the *same* update rather than one of its own,
   * because a transaction may not touch one item twice — two updates on this
   * team would be rejected outright, and only when a team doubled on the way in.
   */
  const teamIndex = writes.length;
  writes.push({
    Update: {
      TableName: table,
      Key: keys.team(gameId, team.id),
      UpdateExpression: writesDouble
        ? "SET lastSubmittedRound = :roundNumber, doubleUsedRound = :roundNumber"
        : "SET lastSubmittedRound = :roundNumber",
      ...(writesDouble
        ? {
            ConditionExpression:
              "attribute_not_exists(doubleUsedRound) OR doubleUsedRound = :unused",
            ExpressionAttributeValues: { ":roundNumber": roundNumber, ":unused": null },
          }
        : { ExpressionAttributeValues: { ":roundNumber": roundNumber } }),
    },
  });

  try {
    await transactWrite(writes);
  } catch (error) {
    const codes = cancellationCodes(error);
    if (codes[markerIndex] === CONDITION_FAILED) {
      throw new ConflictError("Your team has already submitted this round");
    }
    if (writesDouble && codes[teamIndex] === CONDITION_FAILED) {
      // Nothing persisted: the answers were in the same transaction.
      throw new ConflictError("Your team already used its double on another round");
    }
    throw error;
  }

  const view = await snapshot(
    {
      ...state,
      teams: state.teams.map((candidate) =>
        candidate.id === team.id
          ? {
              ...candidate,
              lastSubmittedRound: roundNumber,
              ...(doubled ? { doubleUsedRound: roundNumber } : {}),
            }
          : candidate,
      ),
    },
    "PLAYER",
  );
  return gameUpdate(view, "ANSWERS_SUBMITTED");
}
