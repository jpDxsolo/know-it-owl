import { sumRoundPointsByTeam } from "@know-it-owl/core";
import { requiredInt, requiredString } from "../lib/args.js";
import { tableName, transactWrite } from "../lib/db.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { loadGameState, loadRoundSubmissions, snapshot } from "../lib/gameState.js";
import { assertGm } from "../lib/gmAuth.js";
import * as keys from "../lib/keys.js";
import { gameUpdate, type GameUpdate } from "../lib/views.js";

/** A round can be ended straight from ACTIVE — nobody is obliged to score. */
const ENDABLE = new Set(["ACTIVE", "GRADING"]);

/**
 * DynamoDB caps a transaction at 100 items: the round, the game, and one score
 * update per team that scored.
 */
const MAX_TRANSACT_ITEMS = 100;

/**
 * Reveal a round: publish its answers and fold the entered points into the
 * running scores.
 *
 * The scores and both status changes are one transaction, so there is no window
 * where the answers are public but the standings are stale. Teams that did not
 * submit simply contribute nothing — they are not written and do not block the
 * reveal.
 */
export async function endRound(args: Record<string, unknown>): Promise<GameUpdate> {
  const gameId = requiredString(args, "gameId");
  const gmToken = requiredString(args, "gmToken");
  const roundNumber = requiredInt(args, "roundNumber", { min: 1 });

  const state = await loadGameState(gameId);
  if (!state) throw new NotFoundError("No such game");
  assertGm(gmToken, state.gmTokenHash);

  const round = state.rounds.find((candidate) => candidate.number === roundNumber);
  if (!round) throw new NotFoundError(`No round ${roundNumber} in this game`);
  if (!ENDABLE.has(round.status)) {
    throw new ConflictError(
      round.status === "REVEALED"
        ? `Round ${roundNumber} has already been revealed`
        : `Round ${roundNumber} has not started`,
    );
  }

  const { responses } = await loadRoundSubmissions(gameId, roundNumber);
  // Addition only. A doubled team's points were doubled by the GM on entry.
  const totals = sumRoundPointsByTeam(responses);

  const scoring = state.teams.filter((team) => (totals.get(team.id) ?? 0) !== 0);
  const required = scoring.length + 2;
  if (required > MAX_TRANSACT_ITEMS) {
    throw new ConflictError(
      `This game has too many scoring teams to reveal atomically (${required} writes, limit ${MAX_TRANSACT_ITEMS})`,
    );
  }

  const table = tableName();
  const writes: Parameters<typeof transactWrite>[0] = scoring.map((team) => ({
    Update: {
      TableName: table,
      Key: keys.team(gameId, team.id),
      UpdateExpression: "SET score = score + :points",
      ConditionExpression: "attribute_exists(sk)",
      ExpressionAttributeValues: { ":points": totals.get(team.id) ?? 0 },
    },
  }));

  writes.push({
    Update: {
      TableName: table,
      Key: keys.round(gameId, roundNumber),
      UpdateExpression: "SET #status = :revealed",
      // Loses to a concurrent endRound, so the scores are never added twice.
      ConditionExpression: "#status IN (:active, :grading)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":revealed": "REVEALED",
        ":active": "ACTIVE",
        ":grading": "GRADING",
      },
    },
  });
  writes.push({
    Update: {
      TableName: table,
      Key: keys.gameMeta(gameId),
      UpdateExpression: "SET #status = :reveal",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":reveal": "REVEAL" },
    },
  });

  await transactWrite(writes);

  const view = snapshot(
    {
      ...state,
      game: { ...state.game, status: "REVEAL" },
      rounds: state.rounds.map((candidate) =>
        candidate.number === roundNumber ? { ...candidate, status: "REVEALED" as const } : candidate,
      ),
      teams: state.teams.map((team) => ({
        ...team,
        score: team.score + (totals.get(team.id) ?? 0),
      })),
    },
    "PLAYER",
  );
  return gameUpdate(view, "ROUND_REVEALED");
}
