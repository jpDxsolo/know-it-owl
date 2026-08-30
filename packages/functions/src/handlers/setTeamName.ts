import { requiredString } from "../lib/args.js";
import { updateItem } from "../lib/db.js";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";
import * as keys from "../lib/keys.js";
import { assembleGame, gameUpdate, type GameUpdate } from "../lib/views.js";
import { loadGameView } from "./getGame.js";

const MAX_TEAM_NAME_LENGTH = 30;

/**
 * Rename a team. Any member of that team may do it — there is no per-player
 * secret in this game, so membership is the authorization: the caller must
 * already be assigned to the team they are renaming.
 */
export async function setTeamName(args: Record<string, unknown>): Promise<GameUpdate> {
  const gameId = requiredString(args, "gameId");
  const playerId = requiredString(args, "playerId");
  const teamId = requiredString(args, "teamId");
  const name = requiredString(args, "name", { maxLength: MAX_TEAM_NAME_LENGTH });

  // Player view: the result is fanned out to everyone, not just the caller.
  const view = await loadGameView(gameId);
  if (!view) throw new NotFoundError("No such game");

  const player = view.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new NotFoundError("No such player in this game");

  const team = view.teams.find((candidate) => candidate.id === teamId);
  if (!team) throw new NotFoundError("No such team in this game");

  if (player.teamId !== teamId) {
    throw new ForbiddenError("Only a member of a team may rename it");
  }

  await updateItem(keys.team(gameId, teamId), {
    updateExpression: "SET #name = :name",
    names: { "#name": "name" },
    values: { ":name": name },
    conditionExpression: "attribute_exists(pk)",
  });

  const teams = view.teams.map((candidate) =>
    candidate.id === teamId ? { ...candidate, name } : candidate,
  );
  const snapshot = assembleGame(view, view.players, teams, view.rounds);
  return gameUpdate(snapshot, "TEAM_RENAMED");
}
