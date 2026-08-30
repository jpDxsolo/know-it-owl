import { describe, expect, it } from "vitest";
import { optionalString, requiredInt, requiredString } from "@know-it-owl/functions/lib/args";
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

describe("requiredInt", () => {
  it("reads an integer", () => {
    expect(requiredInt({ teamCount: 3 }, "teamCount")).toBe(3);
  });

  it("rejects a non-integer or non-number", () => {
    expect(() => requiredInt({ teamCount: 2.5 }, "teamCount")).toThrow(ValidationError);
    expect(() => requiredInt({ teamCount: "3" }, "teamCount")).toThrow(/must be an integer/);
    expect(() => requiredInt({}, "teamCount")).toThrow(ValidationError);
  });

  it("enforces min and max inclusively", () => {
    expect(requiredInt({ n: 1 }, "n", { min: 1, max: 4 })).toBe(1);
    expect(requiredInt({ n: 4 }, "n", { min: 1, max: 4 })).toBe(4);
    expect(() => requiredInt({ n: 0 }, "n", { min: 1 })).toThrow(/at least 1/);
    expect(() => requiredInt({ n: 5 }, "n", { max: 4 })).toThrow(/at most 4/);
  });
});
