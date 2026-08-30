import { requiredInt, requiredString } from "../lib/args.js";
import { NotFoundError } from "../lib/errors.js";
import { loadGameState } from "../lib/gameState.js";
import { assertGm } from "../lib/gmAuth.js";
import { createUploadUrl, MAX_IMAGE_BYTES, type UploadTarget } from "../lib/images.js";

/**
 * Mint a presigned PUT for a picture-round image.
 *
 * GM-only: an upload URL is a write into the game's bucket prefix, so it is
 * gated the same way authoring a round is. The returned `imageKey` is what goes
 * into a `QuestionInput`; the bucket is never public, so the key is resolved to
 * a presigned GET whenever a question is served.
 */
export async function getImageUploadUrl(args: Record<string, unknown>): Promise<UploadTarget> {
  const gameId = requiredString(args, "gameId");
  const gmToken = requiredString(args, "gmToken");
  const contentType = requiredString(args, "contentType");
  const contentLength = requiredInt(args, "contentLength", { min: 1, max: MAX_IMAGE_BYTES });

  const state = await loadGameState(gameId);
  if (!state) throw new NotFoundError("No such game");
  assertGm(gmToken, state.gmTokenHash);

  return createUploadUrl(gameId, contentType, contentLength);
}
