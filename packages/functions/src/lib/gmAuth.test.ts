import { describe, expect, it } from "vitest";
import { ForbiddenError } from "./errors.js";
import { assertGm, hashGmToken, verifyGmToken } from "./gmAuth.js";
import { newGmToken } from "./ids.js";

describe("gm auth", () => {
  it("hashes deterministically and never returns the raw token", () => {
    const token = "secret-token";
    const hash = hashGmToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toEqual(hashGmToken(token));
    expect(hash).not.toContain(token);
  });

  it("verifies a matching token and rejects others", () => {
    const token = newGmToken();
    const hash = hashGmToken(token);
    expect(verifyGmToken(token, hash)).toBe(true);
    expect(verifyGmToken(newGmToken(), hash)).toBe(false);
    expect(verifyGmToken(token, "")).toBe(false);
    expect(verifyGmToken(token, "not-hex")).toBe(false);
  });

  it("assertGm throws ForbiddenError for missing or wrong credentials", () => {
    const token = newGmToken();
    const hash = hashGmToken(token);
    expect(() => assertGm(token, hash)).not.toThrow();
    expect(() => assertGm(undefined, hash)).toThrow(ForbiddenError);
    expect(() => assertGm(token, undefined)).toThrow(ForbiddenError);
    expect(() => assertGm("wrong", hash)).toThrow(ForbiddenError);
  });
});
