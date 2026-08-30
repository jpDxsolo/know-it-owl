import type { Team } from "@know-it-owl/core";
import { requiredInt, requiredString } from "../lib/args.js";
import { cancellationCodes, tableName, transactWrite } from "../lib/db.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { loadGameState, snapshot, type GameState } from "../lib/gameState.js";
import * as keys from "../lib/keys.js";
import { gameUpdate, type GameUpdate } from "../lib/views.js";

const CONDITION_FAILED = "ConditionalCheckFailed";

/** The team the caller plays for, or a clear error saying why there isn't one. */
export function callerTeam(state: GameState, playerId: string): Team {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new NotFoundError("No such player in this game");
  if (player.teamId === null) {
    throw new ConflictError("You have not been assigned to a team yet");
  }
  const team = state.teams.find((candidate) => candidate.id === player.teamId);
  if (!team) throw new NotFoundError("No such team in this game");
  return team;
}

/**
 * Flag the current round as the caller's team double.
 *
 * Two teammates tapping this at once is expected on quiz night, so neither the
 * "one double per game" rule nor "not after you have submitted" is enforced by
 * the reads above: both ride on conditions inside one transaction, and the
 * loser gets a CONFLICT rather than a second double or a retroactive one.
 */
export async function chooseDouble(args: Record<string, unknown>): Promise<GameUpdate> {
  const gameId = requiredString(args, "gameId");
  const playerId = requiredString(args, "playerId");
  const roundNumber = requiredInt(args, "roundNumber", { min: 1 });

  const state = await loadGameState(gameId);
  if (!state) throw new NotFoundError("No such game");

  const team = callerTeam(state, playerId);

  const round = state.rounds.find((candidate) => candidate.number === roundNumber);
  if (!round) throw new NotFoundError(`No round ${roundNumber} in this game`);
  if (round.status !== "ACTIVE") {
    throw new ConflictError(`Round ${roundNumber} is not in play`);
  }

  const table = tableName();
  try {
    await transactWrite([
      {
        // Doubling after you have already handed in would be a retroactive bet.
        ConditionCheck: {
          TableName: table,
          Key: keys.submission(gameId, roundNumber, team.id),
          ConditionExpression: "attribute_not_exists(sk)",
        },
      },
      {
        Update: {
          TableName: table,
          Key: keys.team(gameId, team.id),
          UpdateExpression: "SET doubleUsedRound = :roundNumber",
          ConditionExpression:
            "attribute_not_exists(doubleUsedRound) OR doubleUsedRound = :unused",
          ExpressionAttributeValues: { ":roundNumber": roundNumber, ":unused": null },
        },
      },
    ]);
  } catch (error) {
    const [submitted, doubled] = cancellationCodes(error);
    if (submitted === CONDITION_FAILED) {
      throw new ConflictError("Your team has already submitted this round");
    }
    if (doubled === CONDITION_FAILED) {
      throw new ConflictError(
        team.doubleUsedRound === roundNumber
          ? "Your team has already doubled this round"
          : `Your team already used its double on round ${team.doubleUsedRound}`,
      );
    }
    throw error;
  }

  const view = await snapshot(
    {
      ...state,
      teams: state.teams.map((candidate) =>
        candidate.id === team.id ? { ...candidate, doubleUsedRound: roundNumber } : candidate,
      ),
    },
    "PLAYER",
  );
  return gameUpdate(view, "DOUBLE_CHOSEN");
}
