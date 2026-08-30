import type { Player } from "@know-it-owl/core";
import { requiredString } from "../lib/args.js";
import { getItem, putItem } from "../lib/db.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import * as keys from "../lib/keys.js";
import type { JoinCodeItem, PlayerItem } from "../lib/mappers.js";
import { assembleGame, type JoinGamePayload } from "../lib/views.js";
import { loadGameView } from "./getGame.js";

const MAX_JOIN_CODE_LENGTH = 12;
const MAX_PLAYER_ID_LENGTH = 64;
const MAX_DISPLAY_NAME_LENGTH = 30;

/** Resolve a join code to its game id via the JOINCODE# lookup item. */
async function gameIdForCode(code: string): Promise<string> {
  const item = await getItem<JoinCodeItem>(keys.joinCode(code));
  if (!item || typeof item.gameId !== "string") {
    throw new NotFoundError("No game with that join code");
  }
  return item.gameId;
}

/**
 * Add a player to a game in LOBBY.
 *
 * The client supplies `playerId`, so a retried or replayed call must not create
 * a second player: the write is keyed on that id and carries the existing
 * `teamId` forward, making a repeat join a no-op apart from the display name.
 */
export async function joinGame(args: Record<string, unknown>): Promise<JoinGamePayload> {
  const code = requiredString(args, "joinCode", {
    uppercase: true,
    maxLength: MAX_JOIN_CODE_LENGTH,
  });
  const playerId = requiredString(args, "playerId", { maxLength: MAX_PLAYER_ID_LENGTH });
  const displayName = requiredString(args, "displayName", {
    maxLength: MAX_DISPLAY_NAME_LENGTH,
  });

  const gameId = await gameIdForCode(code);
  const view = await loadGameView(gameId);
  if (!view) {
    // The code item outlived its game; treat it as a dead code rather than a 500.
    throw new NotFoundError("No game with that join code");
  }
  if (view.status !== "LOBBY") {
    throw new ConflictError("This game has already started");
  }

  const existing = view.players.find((candidate) => candidate.id === playerId);
  const nameTaken = view.players.some(
    (candidate) =>
      candidate.id !== playerId &&
      candidate.displayName.toLowerCase() === displayName.toLowerCase(),
  );
  if (nameTaken) {
    throw new ConflictError(`"${displayName}" is already taken in this game`);
  }

  const player: Player = {
    id: playerId,
    displayName,
    teamId: existing?.teamId ?? null,
  };
  const item: PlayerItem = {
    ...keys.player(gameId, playerId),
    displayName: player.displayName,
    teamId: player.teamId,
  };
  await putItem(item);

  const players = existing
    ? view.players.map((candidate) => (candidate.id === playerId ? player : candidate))
    : [...view.players, player];

  return { game: assembleGame(view, players, view.teams, view.rounds), player };
}
