import { optionalString, requiredString } from "../lib/args.js";
import { loadGameState, snapshot } from "../lib/gameState.js";
import { viewerRole } from "../lib/visibility.js";
import type { GameView } from "../lib/views.js";

/**
 * Load a game as the schema's `Game` type, filtered for whoever is asking.
 *
 * The role is derived here rather than passed in, so a caller cannot hand us a
 * role it did not prove: the only way to get the GM view is to present a token
 * that verifies against the hash on the META item. Real-time fan-out builds a
 * player snapshot by simply omitting the token.
 *
 * Returns `undefined` when the game does not exist.
 */
export async function loadGameView(
  gameId: string,
  gmToken?: string,
): Promise<GameView | undefined> {
  const state = await loadGameState(gameId);
  if (!state) return undefined;
  return snapshot(state, viewerRole(gmToken, state.gmTokenHash));
}

/** `Query.game(gameId, gmToken)` — nullable in the schema, so a missing game is null, not an error. */
export async function getGame(args: Record<string, unknown>): Promise<GameView | null> {
  const gameId = requiredString(args, "gameId");
  const gmToken = optionalString(args, "gmToken");
  return (await loadGameView(gameId, gmToken)) ?? null;
}
