import { tableName, transactWrite } from "../lib/db.js";
import { ConflictError } from "../lib/errors.js";
import { hashGmToken } from "../lib/gmAuth.js";
import { newGameId, newGmToken, newJoinCode } from "../lib/ids.js";
import * as keys from "../lib/keys.js";
import { toGame, type GameMetaItem, type JoinCodeItem } from "../lib/mappers.js";
import type { CreateGamePayload } from "../lib/views.js";

/**
 * Six characters from a 32-symbol alphabet collide rarely but not never, so the
 * join-code item is written under `attribute_not_exists` and a cancelled
 * transaction means "that code is taken" — try a fresh one.
 */
const MAX_JOIN_CODE_ATTEMPTS = 5;

const IF_ABSENT = "attribute_not_exists(pk)";

function isTransactionCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "TransactionCanceledException";
}

/**
 * Create a game in LOBBY and return it with the one-time GM token. The token
 * itself is never stored — the META item holds only its SHA-256 hash.
 */
export async function createGame(): Promise<CreateGamePayload> {
  const gameId = newGameId();
  const gmToken = newGmToken();
  const gmTokenHash = hashGmToken(gmToken);
  const createdAt = new Date().toISOString();

  for (let attempt = 1; attempt <= MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const code = newJoinCode();
    const meta: GameMetaItem = {
      ...keys.gameMeta(gameId),
      status: "LOBBY",
      gmTokenHash,
      joinCode: code,
      currentRound: null,
      createdAt,
    };
    const codeItem: JoinCodeItem = { ...keys.joinCode(code), gameId };

    try {
      await transactWrite([
        { Put: { TableName: tableName(), Item: codeItem, ConditionExpression: IF_ABSENT } },
        { Put: { TableName: tableName(), Item: meta, ConditionExpression: IF_ABSENT } },
      ]);
    } catch (error) {
      if (isTransactionCancelled(error) && attempt < MAX_JOIN_CODE_ATTEMPTS) continue;
      throw error;
    }

    // toGame drops gmTokenHash, so the payload carries the raw token and nothing else.
    return { game: { ...toGame(meta), players: [], teams: [] }, gmToken };
  }

  throw new ConflictError(
    `Could not allocate a free join code after ${MAX_JOIN_CODE_ATTEMPTS} attempts`,
  );
}
