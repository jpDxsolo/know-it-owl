import { requiredString } from "../lib/args.js";
import { NotFoundError } from "../lib/errors.js";
import { loadGameState } from "../lib/gameState.js";
import { assembleGame, type TeamView } from "../lib/views.js";

/**
 * Teams ranked by score, highest first, with name as the tie-break so a drawn
 * table has a stable order rather than whatever DynamoDB returned.
 */
export function standingsFor(teams: TeamView[]): TeamView[] {
  return [...teams].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/** `Query.standings(gameId)` — public; scores are the whole point of the leaderboard. */
export async function standings(args: Record<string, unknown>): Promise<TeamView[]> {
  const gameId = requiredString(args, "gameId");

  const state = await loadGameState(gameId);
  if (!state) throw new NotFoundError("No such game");

  const game = assembleGame(state.game, state.players, state.teams, []);
  return standingsFor(game.teams);
}
