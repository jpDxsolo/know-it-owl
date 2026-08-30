import { describe, expect, it } from "vitest";
import { optionalString, requiredString } from "@know-it-owl/functions/lib/args";
import { ValidationError } from "@know-it-owl/functions/lib/errors";

describe("requiredString", () => {
  it("trims surrounding whitespace", () => {
    expect(requiredString({ name: "  Ada  " }, "name")).toBe("Ada");
  });

  it("uppercases when asked", () => {
    expect(requiredString({ code: " ab3d5f " }, "code", { uppercase: true })).toBe("AB3D5F");
  });

  it("rejects a missing argument", () => {
    expect(() => requiredString({}, "name")).toThrow(ValidationError);
  });

  it("rejects a non-string argument", () => {
    expect(() => requiredString({ name: 7 }, "name")).toThrow(/must be a string/);
  });

  it("rejects whitespace-only input", () => {
    expect(() => requiredString({ name: "   " }, "name")).toThrow(/must not be empty/);
  });

  it("enforces maxLength after trimming", () => {
    expect(requiredString({ name: " abcd " }, "name", { maxLength: 4 })).toBe("abcd");
    expect(() => requiredString({ name: "abcde" }, "name", { maxLength: 4 })).toThrow(
      /at most 4 characters/,
    );
  });
});

describe("optionalString", () => {
  it("treats undefined and null as absent", () => {
    expect(optionalString({}, "token")).toBeUndefined();
    expect(optionalString({ token: null }, "token")).toBeUndefined();
  });

  it("validates a value that is present", () => {
    expect(optionalString({ token: " t " }, "token")).toBe("t");
    expect(() => optionalString({ token: "" }, "token")).toThrow(ValidationError);
  });
});
