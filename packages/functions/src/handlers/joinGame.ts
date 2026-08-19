export async function joinGame(_args: Record<string, unknown>): Promise<unknown> {
  // TODO: look up game by joinCode, require status LOBBY, put GAME#<id>/PLAYER#<playerId>
  // with displayName. Return { game, player } and fan out PLAYER_JOINED.
  throw new Error("Not implemented: joinGame");
}
