import type { Question, Round } from "@know-it-owl/core";
import { optionalString, requiredString } from "../lib/args.js";
import { getItem, queryPrefix } from "../lib/db.js";
import * as keys from "../lib/keys.js";
import { isQuestionKey, toGame, toPlayer, toQuestion, toRound, toTeam } from "../lib/mappers.js";
import { viewerRole, visibleRounds } from "../lib/visibility.js";
import { assembleGame, type GameView } from "../lib/views.js";

function byNumber<T extends { number: number }>(items: T[]): T[] {
  // A ROUND# query comes back in sort-key order, where ROUND#10 precedes ROUND#2.
  return [...items].sort((a, b) => a.number - b.number);
}

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
  const meta = await getItem(keys.gameMeta(gameId));
  if (!meta) return undefined;

  const storedHash = typeof meta.gmTokenHash === "string" ? meta.gmTokenHash : undefined;
  const role = viewerRole(gmToken, storedHash);

  const pk = keys.gamePk(gameId);
  const [playerItems, teamItems, roundItems] = await Promise.all([
    queryPrefix(pk, keys.prefixes.players()),
    queryPrefix(pk, keys.prefixes.teams()),
    queryPrefix(pk, keys.prefixes.rounds()),
  ]);

  // One ROUND# query returns rounds and their questions interleaved.
  const rounds: Round[] = byNumber(
    roundItems.filter((item) => !isQuestionKey(item.sk)).map(toRound),
  );
  const questions: Question[] = byNumber(
    roundItems.filter((item) => isQuestionKey(item.sk)).map(toQuestion),
  );

  return assembleGame(
    toGame(meta),
    playerItems.map(toPlayer),
    teamItems.map(toTeam),
    // Answer keys are in memory for the length of this call; visibleRounds is
    // the only thing standing between them and the response, which is why it
    // lives in one module rather than being re-derived per handler.
    visibleRounds(rounds, questions, role),
  );
}

/** `Query.game(gameId, gmToken)` — nullable in the schema, so a missing game is null, not an error. */
export async function getGame(args: Record<string, unknown>): Promise<GameView | null> {
  const gameId = requiredString(args, "gameId");
  const gmToken = optionalString(args, "gmToken");
  return (await loadGameView(gameId, gmToken)) ?? null;
}
