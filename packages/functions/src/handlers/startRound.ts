import { requiredInt, requiredString } from "../lib/args.js";
import { tableName, transactWrite } from "../lib/db.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { loadGameState, snapshot } from "../lib/gameState.js";
import { assertGm } from "../lib/gmAuth.js";
import * as keys from "../lib/keys.js";
import { gameUpdate, type GameUpdate } from "../lib/views.js";

/** A round may only start between other rounds, not on top of one. */
const STARTABLE_FROM = new Set(["TEAMS_SET", "REVEAL"]);

/**
 * Move a DRAFT round to ACTIVE and unveil its first question.
 *
 * Both writes carry conditions matching the checks above, so a concurrent
 * startRound on the same round loses at the database rather than double-starting.
 */
export async function startRound(args: Record<string, unknown>): Promise<GameUpdate> {
  const gameId = requiredString(args, "gameId");
  const gmToken = requiredString(args, "gmToken");
  const roundNumber = requiredInt(args, "roundNumber", { min: 1 });

  const state = await loadGameState(gameId);
  if (!state) throw new NotFoundError("No such game");
  assertGm(gmToken, state.gmTokenHash);

  if (!STARTABLE_FROM.has(state.game.status)) {
    throw new ConflictError("Finish the round in play before starting another");
  }

  const round = state.rounds.find((candidate) => candidate.number === roundNumber);
  if (!round) throw new NotFoundError(`No round ${roundNumber} in this game`);
  if (round.status !== "DRAFT") {
    throw new ConflictError(`Round ${roundNumber} has already been started`);
  }

  const questionCount = state.questions.filter(
    (question) => question.roundNumber === roundNumber,
  ).length;
  if (questionCount === 0) {
    throw new ConflictError(`Round ${roundNumber} has no questions`);
  }

  const table = tableName();
  await transactWrite([
    {
      Update: {
        TableName: table,
        Key: keys.round(gameId, roundNumber),
        UpdateExpression: "SET #status = :active, releasedCount = :one",
        ConditionExpression: "#status = :draft",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":active": "ACTIVE", ":draft": "DRAFT", ":one": 1 },
      },
    },
    {
      Update: {
        TableName: table,
        Key: keys.gameMeta(gameId),
        UpdateExpression: "SET #status = :active, currentRound = :roundNumber",
        ConditionExpression: "#status IN (:teamsSet, :reveal)",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":active": "ROUND_ACTIVE",
          ":teamsSet": "TEAMS_SET",
          ":reveal": "REVEAL",
          ":roundNumber": roundNumber,
        },
      },
    },
  ]);

  // Snapshot what was just written. Player view: this fans out to everyone, so
  // only question 1 travels with it.
  const started = { ...round, status: "ACTIVE" as const, releasedCount: 1 };
  const view = snapshot(
    {
      ...state,
      game: { ...state.game, status: "ROUND_ACTIVE", currentRound: roundNumber },
      rounds: state.rounds.map((candidate) =>
        candidate.number === roundNumber ? started : candidate,
      ),
    },
    "PLAYER",
  );
  return gameUpdate(view, "ROUND_STARTED");
}
