import { requiredString } from "../lib/args.js";
import { tableName, transactWrite } from "../lib/db.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { loadGameState, snapshot } from "../lib/gameState.js";
import { assertGm } from "../lib/gmAuth.js";
import * as keys from "../lib/keys.js";
import { gameUpdate, type GameUpdate } from "../lib/views.js";

/**
 * A quiz ends between rounds, never in the middle of one.
 *
 * REVEAL is the only moment where every score is settled: the round has been
 * marked, the points are in the standings, and nothing is half-entered. Ending
 * from ROUND_ACTIVE or GRADING would freeze a round that teams had already
 * answered out of the final scores, which is the one thing a scoreboard must
 * never do.
 */
const FINISHABLE_FROM = new Set(["REVEAL"]);

/**
 * Declare the game over.
 *
 * Deliberately a decision the host makes rather than something inferred from
 * running out of rounds: a quiz ends when the host says so, and "no rounds
 * left" is a state they may simply be about to fix by writing another.
 *
 * Nothing is recalculated here. The scores are already whatever `endRound`
 * folded into them, so finishing is a status change and nothing more — the
 * standings a player sees a moment before the game ends are the standings they
 * see afterwards, which is what makes the final scoreboard trustworthy.
 */
export async function finishGame(args: Record<string, unknown>): Promise<GameUpdate> {
  const gameId = requiredString(args, "gameId");
  const gmToken = requiredString(args, "gmToken");

  const state = await loadGameState(gameId);
  if (!state) throw new NotFoundError("No such game");
  assertGm(gmToken, state.gmTokenHash);

  if (!FINISHABLE_FROM.has(state.game.status)) {
    throw new ConflictError(
      state.game.status === "FINISHED"
        ? "This game has already finished"
        : "Reveal the round in play before finishing the game",
    );
  }

  await transactWrite([
    {
      Update: {
        TableName: tableName(),
        Key: keys.gameMeta(gameId),
        UpdateExpression: "SET #status = :finished",
        // Loses to a host who started another round in the meantime, rather
        // than ending a game that has moved on.
        ConditionExpression: "#status = :reveal",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":finished": "FINISHED", ":reveal": "REVEAL" },
      },
    },
  ]);

  const view = await snapshot(
    { ...state, game: { ...state.game, status: "FINISHED" } },
    "PLAYER",
  );
  return gameUpdate(view, "GAME_FINISHED");
}
