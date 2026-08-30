/**
 * Putting a picture into a round.
 *
 * Two steps, and the second one is unforgiving: `getImageUploadUrl` signs a URL
 * for one exact content type and one exact byte count, so the PUT must match
 * both or S3 answers 403 with nothing useful in it. That is why the size and
 * type are checked here, before asking for a URL — a clear message beats a bare
 * 403 that looks like a permissions problem.
 */
import { ApiError, execute, GetImageUploadUrlMutation } from "./api";

/** Mirrors the allow-list the server enforces. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readableSize(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

/**
 * Upload one image and return the key to store on the question. The URL is
 * short-lived and single-purpose, so it is fetched per upload rather than kept.
 */
export async function uploadImage(
  gameId: string,
  gmToken: string,
  file: File,
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    throw new ApiError(
      `${file.type || "That file"} isn't an image we can use — try JPEG, PNG, WebP or GIF.`,
      "VALIDATION",
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ApiError(
      `That image is ${readableSize(file.size)}. The limit is ${readableSize(MAX_IMAGE_BYTES)}.`,
      "VALIDATION",
    );
  }

  const signed = await execute(GetImageUploadUrlMutation, {
    gameId,
    gmToken,
    contentType: file.type,
    contentLength: file.size,
  });

  let response: Response;
  try {
    response = await fetch(signed.getImageUploadUrl.uploadUrl, {
      method: "PUT",
      // Content-Length is set by the browser from the body and must not be set
      // by hand; the type is signed in and must match exactly.
      headers: { "Content-Type": file.type },
      body: file,
    });
  } catch {
    throw new ApiError("The upload didn't reach us. Check your signal and try again.", "NETWORK");
  }

  if (!response.ok) {
    throw new ApiError(
      `The upload was refused (${response.status}). Try picking the image again.`,
      "NETWORK",
    );
  }

  return signed.getImageUploadUrl.imageKey;
}
