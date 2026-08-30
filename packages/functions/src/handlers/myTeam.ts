import { requiredString } from "../lib/args.js";
import { NotFoundError } from "../lib/errors.js";
import type { TeamView } from "../lib/views.js";
import { loadGameView } from "./getGame.js";

/**
 * `Query.myTeam(gameId, playerId)` — the caller's team and its roster.
 *
 * Nullable in the schema: a player who has joined but has not been dealt a team
 * yet gets null, not an error. An unknown player is an error, because that means
 * the client is asking about someone who never joined.
 */
export async function myTeam(args: Record<string, unknown>): Promise<TeamView | null> {
  const gameId = requiredString(args, "gameId");
  const playerId = requiredString(args, "playerId");

  const view = await loadGameView(gameId);
  if (!view) throw new NotFoundError("No such game");

  const player = view.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new NotFoundError("No such player in this game");
  if (player.teamId === null) return null;

  return view.teams.find((team) => team.id === player.teamId) ?? null;
}
