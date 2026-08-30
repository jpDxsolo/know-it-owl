import { requiredString } from "../lib/args.js";
import { getItem, queryPrefix } from "../lib/db.js";
import * as keys from "../lib/keys.js";
import { mapItems, toGame, toPlayer, toTeam } from "../lib/mappers.js";
import { assembleGame, type GameView } from "../lib/views.js";

/**
 * Load a game as the schema's `Game` type: the META item plus its players and
 * teams. Rounds, questions and responses live in the same partition but are
 * deliberately not queried here — nothing in `Game` exposes them, and not
 * reading the answer keys is cheaper than filtering them out afterwards.
 *
 * Returns `undefined` when the game does not exist.
 */
export async function loadGameView(gameId: string): Promise<GameView | undefined> {
  const meta = await getItem(keys.gameMeta(gameId));
  if (!meta) return undefined;

  const pk = keys.gamePk(gameId);
  const [playerItems, teamItems] = await Promise.all([
    queryPrefix(pk, keys.prefixes.players()),
    queryPrefix(pk, keys.prefixes.teams()),
  ]);

  return assembleGame(
    toGame(meta),
    mapItems(playerItems, keys.prefixes.players(), toPlayer),
    mapItems(teamItems, keys.prefixes.teams(), toTeam),
  );
}

/** `Query.game(gameId)` — nullable in the schema, so a missing game is null, not an error. */
export async function getGame(args: Record<string, unknown>): Promise<GameView | null> {
  const gameId = requiredString(args, "gameId");
  return (await loadGameView(gameId)) ?? null;
}
