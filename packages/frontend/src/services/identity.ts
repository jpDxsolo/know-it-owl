/**
 * Who this browser is, remembered across reloads.
 *
 * Two different things live here and they are not equally replaceable:
 *
 * - A **player id** is this browser's claim on a seat. `joinGame` is keyed on
 *   it, so re-joining with the same id is a no-op rather than a second player —
 *   which is exactly what makes a refresh mid-game survivable.
 * - A **GM token** is a secret the server hands out once, at `createGame`, and
 *   cannot reissue. Lose it and the game is unrunnable. It is stored per game.
 *
 * localStorage is per-origin and per-device, so a GM on their phone is not the
 * GM on their laptop. That is a real limitation, not an oversight: the token is
 * the only proof, and the server keeps a hash of it.
 */

const PLAYER_ID_KEY = "kio.playerId";
const DISPLAY_NAME_KEY = "kio.displayName";
const GM_TOKEN_PREFIX = "kio.gmToken.";
const LAST_GAME_KEY = "kio.lastGame";

/**
 * Reading storage can throw, not just return null: Safari in private mode and
 * browsers set to block site data both raise on access. A player without
 * storage should still be able to play — they just will not survive a refresh —
 * so every read degrades to "nothing stored" and every write to a no-op.
 */
function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage is unavailable or full. The value lives for this page only.
  }
}

function remove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // As above.
  }
}

/** In-memory fallback, so identity is at least stable within one page life. */
let sessionPlayerId: string | undefined;

/**
 * This browser's player id, minted on first use and stable thereafter.
 *
 * Never regenerate this casually: a new id is a new player at the next
 * `joinGame`, leaving the old one orphaned on a team.
 */
export function playerId(): string {
  const stored = read(PLAYER_ID_KEY);
  if (stored) return stored;
  if (!sessionPlayerId) sessionPlayerId = crypto.randomUUID();
  write(PLAYER_ID_KEY, sessionPlayerId);
  return sessionPlayerId;
}

/** The last display name used, to prefill the join form. */
export function displayName(): string | null {
  return read(DISPLAY_NAME_KEY);
}

export function setDisplayName(name: string): void {
  write(DISPLAY_NAME_KEY, name);
}

/** The GM token for one game, or null if this browser did not create it. */
export function gmToken(gameId: string): string | null {
  return read(GM_TOKEN_PREFIX + gameId);
}

/**
 * Remember the token `createGame` just returned. The server only ever shows it
 * once, so a failure to store it here is unrecoverable — hence
 * {@link gmTokenIsPersisted} for callers that want to warn about it.
 */
export function setGmToken(gameId: string, token: string): void {
  write(GM_TOKEN_PREFIX + gameId, token);
}

export function clearGmToken(gameId: string): void {
  remove(GM_TOKEN_PREFIX + gameId);
}

/** Whether this browser is the GM of the given game. */
export function isGm(gameId: string): boolean {
  return gmToken(gameId) !== null;
}

/**
 * Whether the token actually made it to disk. False means storage is blocked
 * and the GM will lose control of the game on refresh — worth telling them.
 */
export function gmTokenIsPersisted(gameId: string): boolean {
  return read(GM_TOKEN_PREFIX + gameId) !== null;
}

/** Every game this browser holds a GM token for. */
export function gmGameIds(): string[] {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return [];
    const ids: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(GM_TOKEN_PREFIX)) ids.push(key.slice(GM_TOKEN_PREFIX.length));
    }
    return ids;
  } catch {
    return [];
  }
}

/**
 * The game this browser last joined.
 *
 * Remembered so a player who closes the tab, locks their phone, or wanders off
 * to the bar mid-round can be offered their way back in rather than being asked
 * for a code they no longer have. Since `joinGame` is idempotent on the player
 * id, rejoining is genuinely a return to the same seat, not a second player.
 */
export interface LastGame {
  gameId: string;
  joinCode: string;
  displayName: string;
}

export function lastGame(): LastGame | null {
  const raw = read(LAST_GAME_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { gameId, joinCode, displayName } = parsed as Record<string, unknown>;
    if (typeof gameId !== "string" || typeof joinCode !== "string") return null;
    return {
      gameId,
      joinCode,
      displayName: typeof displayName === "string" ? displayName : "",
    };
  } catch {
    // Something else wrote this key, or it was truncated. Not worth a crash.
    return null;
  }
}

export function setLastGame(game: LastGame): void {
  write(LAST_GAME_KEY, JSON.stringify(game));
}

export function clearLastGame(): void {
  remove(LAST_GAME_KEY);
}

/** Drop everything this module owns. For a "start over" affordance. */
export function clearIdentity(): void {
  for (const gameId of gmGameIds()) clearGmToken(gameId);
  remove(PLAYER_ID_KEY);
  remove(DISPLAY_NAME_KEY);
  remove(LAST_GAME_KEY);
  sessionPlayerId = undefined;
}
