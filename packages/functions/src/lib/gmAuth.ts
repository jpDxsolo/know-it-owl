import { createHash, timingSafeEqual } from "node:crypto";
import { ForbiddenError } from "./errors.js";

/** Hash a GM token for storage — the raw token is never persisted. */
export function hashGmToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of a presented token against a stored hash. */
export function verifyGmToken(token: string, storedHash: string): boolean {
  const presented = Buffer.from(hashGmToken(token), "hex");
  let stored: Buffer;
  try {
    stored = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (presented.length !== stored.length) return false;
  return timingSafeEqual(presented, stored);
}

/** Throw unless the presented token matches the stored hash. */
export function assertGm(token: string | undefined, storedHash: string | undefined): void {
  if (!token || !storedHash || !verifyGmToken(token, storedHash)) {
    throw new ForbiddenError("Invalid game master token");
  }
}
