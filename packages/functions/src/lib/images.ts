/**
 * Presigned S3 access for picture rounds.
 *
 * The bucket is private and stays that way: nothing is ever served from it
 * directly. The GM gets a short-lived PUT URL to upload with, and viewers get
 * a one-hour GET URL minted per response. A stale GET simply 403s and the next
 * subscription update carries a fresh one — the v1 trade for not running a
 * CloudFront distribution.
 */
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ValidationError } from "./errors.js";
import type { VisibleQuestion, VisibleRound } from "./visibility.js";

/** Upload allowlist. Anything not on it never reaches the bucket. */
export const ALLOWED_CONTENT_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Long enough to pick a file and upload it; short enough that a leaked URL dies fast. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/** One hour, matched to how long a team is likely to sit on a picture round. */
export const VIEW_URL_TTL_SECONDS = 60 * 60;

let s3Client: S3Client | undefined;

export function getS3Client(): S3Client {
  if (!s3Client) s3Client = new S3Client({});
  return s3Client;
}

/** Override the client (tests inject an aws-sdk-client-mock instance). */
export function setS3Client(client: S3Client | undefined): void {
  s3Client = client;
}

/**
 * Name of the images bucket. `IMAGES_BUCKET` is what the deployed function is
 * given (sst.config.ts passes it through), and what tests and local runs
 * override. The `SST_RESOURCE_Images` fallback covers a v2-style link.
 */
export function bucketName(): string {
  const explicit = process.env.IMAGES_BUCKET;
  if (explicit) return explicit;
  const linked = process.env.SST_RESOURCE_Images;
  if (linked) {
    const parsed: unknown = JSON.parse(linked);
    if (parsed && typeof parsed === "object" && "name" in parsed) {
      const name = (parsed as { name: unknown }).name;
      if (typeof name === "string") return name;
    }
  }
  throw new Error("Images bucket is not configured (set IMAGES_BUCKET or link the SST bucket)");
}

/** Game-scoped so a game's images can be found — and dropped — together. */
export function newImageKey(gameId: string): string {
  return `games/${gameId}/${randomUUID()}`;
}

export interface UploadTarget {
  uploadUrl: string;
  imageKey: string;
}

/**
 * Mint a presigned PUT for one image.
 *
 * Both the content type and the exact byte length are signed, so S3 itself
 * rejects an upload that changes either: a client cannot declare a 1 MB JPEG
 * and then push 40 MB of something else through the same URL.
 */
export async function createUploadUrl(
  gameId: string,
  contentType: string,
  contentLength: number,
): Promise<UploadTarget> {
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new ValidationError(
      `"${contentType}" is not an allowed image type (${ALLOWED_CONTENT_TYPES.join(", ")})`,
    );
  }
  if (!Number.isInteger(contentLength) || contentLength <= 0) {
    throw new ValidationError('"contentLength" must be a positive integer');
  }
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new ValidationError(
      `Images must be at most ${MAX_IMAGE_BYTES} bytes (got ${contentLength})`,
    );
  }

  const imageKey = newImageKey(gameId);
  const uploadUrl = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: imageKey,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      // Signing these makes them conditions rather than suggestions.
      signableHeaders: new Set(["content-type", "content-length"]),
    },
  );

  return { uploadUrl, imageKey };
}

/** Mint a presigned GET so a browser can display one stored image. */
export async function createViewUrl(imageKey: string): Promise<string> {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: bucketName(), Key: imageKey }),
    { expiresIn: VIEW_URL_TTL_SECONDS },
  );
}

/** A question as it leaves the API: the storage key replaced by a usable URL. */
export interface SignedQuestion extends Omit<VisibleQuestion, "imageKey"> {
  imageUrl: string | null;
  /**
   * The storage key, for the host only.
   *
   * A presigned URL dies within the hour, so it is no use to a quiz saved to a
   * file and opened next week — that needs the key the image is actually
   * stored under. Players get `imageUrl` and nothing else; there is no reason
   * for them to know where the bytes live — so for a player the property is
   * absent entirely rather than null, and "no key appears in a player payload"
   * stays literally true of the serialised object.
   */
  imageKey?: string;
}

export interface SignedRound extends Omit<VisibleRound, "questions"> {
  questions: SignedQuestion[];
}

/**
 * Replace every `imageKey` with a presigned GET URL.
 *
 * One signature per distinct key, computed in parallel: a picture round asked
 * for by ten teams at once should not mint the same URL ten times over.
 *
 * `keepKeys` additionally carries the key through, and is for the host alone —
 * see `SignedQuestion.imageKey`.
 */
export async function signRounds(
  rounds: VisibleRound[],
  keepKeys = false,
): Promise<SignedRound[]> {
  const keys = new Set<string>();
  for (const round of rounds) {
    for (const question of round.questions) {
      if (question.imageKey !== undefined) keys.add(question.imageKey);
    }
  }

  const signed = await Promise.all(
    [...keys].map(async (key) => [key, await createViewUrl(key)] as const),
  );
  const urls = new Map(signed);

  return rounds.map((round) => ({
    ...round,
    questions: round.questions.map((question) => {
      const { imageKey, ...rest } = question;
      return {
        ...rest,
        imageUrl: imageKey === undefined ? null : (urls.get(imageKey) ?? null),
        ...(keepKeys && imageKey !== undefined ? { imageKey } : {}),
      };
    }),
  }));
}
