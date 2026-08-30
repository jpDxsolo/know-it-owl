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

function missingSubmissions(teams: readonly { id: string; name: string }[], submittedIds: Set<string>): string[] {
  return teams.filter((team) => !submittedIds.has(team.id)).map((team) => team.name);
}

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
 * where the answers are public but the standings are stale. Every team must
 * have submitted first — a reveal with an outstanding team would freeze their
 * answers out of the scoreboard.
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

  const { responses, submissions } = await loadRoundSubmissions(gameId, roundNumber);

  // Every team must have handed in before the round can be revealed — otherwise
  // a stragglers' answers would be locked out of the scoreboard.
  const submittedIds = new Set(submissions.map((entry) => entry.teamId));
  const outstanding = missingSubmissions(state.teams, submittedIds);
  if (outstanding.length > 0) {
    throw new ConflictError(
      `Cannot end round ${roundNumber}: ${outstanding.join(", ")} ${outstanding.length === 1 ? "has" : "have"} not submitted`,
    );
  }

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
      // Every other status write is conditional; this one was not, so a REVEAL
      // could stomp a game that had already moved on.
      ConditionExpression: "#status IN (:roundActive, :grading)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":reveal": "REVEAL",
        ":roundActive": "ROUND_ACTIVE",
        ":grading": "GRADING",
      },
    },
  });

  await transactWrite(writes);

  const view = await snapshot(
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
