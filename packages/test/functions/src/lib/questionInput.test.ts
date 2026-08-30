import { describe, expect, it } from "vitest";
import { ValidationError } from "@know-it-owl/functions/lib/errors";
import { parseQuestionInputs } from "@know-it-owl/functions/lib/questionInput";

const MAX = 99;

function text(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "TEXT", text: "Capital of France?", correctAnswers: ["Paris"], defaultPoints: 1, ...overrides };
}

function picture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "PICTURE_10",
    imageKey: "images/g1/birds.png",
    correctAnswers: Array.from({ length: 10 }, (_, i) => `Bird ${i + 1}`),
    defaultPoints: 10,
    ...overrides,
  };
}

describe("parseQuestionInputs", () => {
  it("accepts a TEXT question", () => {
    expect(parseQuestionInputs([text()], MAX)).toEqual([
      { type: "TEXT", text: "Capital of France?", correctAnswers: ["Paris"], defaultPoints: 1 },
    ]);
  });

  it("accepts a PICTURE_10 question with exactly ten answers", () => {
    const [parsed] = parseQuestionInputs([picture()], MAX);
    expect(parsed.type).toBe("PICTURE_10");
    expect(parsed.correctAnswers).toHaveLength(10);
    expect(parsed.imageKey).toBe("images/g1/birds.png");
  });

  it("keeps an optional prompt on a PICTURE_10 question", () => {
    const [parsed] = parseQuestionInputs([picture({ text: "Name these birds" })], MAX);
    expect(parsed.text).toBe("Name these birds");
  });

  it("trims text and answers", () => {
    const [parsed] = parseQuestionInputs([text({ text: "  Q?  ", correctAnswers: [" Paris "] })], MAX);
    expect(parsed.text).toBe("Q?");
    expect(parsed.correctAnswers).toEqual(["Paris"]);
  });

  it("names the offending index in the error", () => {
    expect(() => parseQuestionInputs([text(), text({ text: "   " })], MAX)).toThrow(
      /questions\[1\]/,
    );
  });

  it("rejects a TEXT question with no text", () => {
    expect(() => parseQuestionInputs([text({ text: "  " })], MAX)).toThrow(/needs non-empty text/);
    expect(() => parseQuestionInputs([text({ text: undefined })], MAX)).toThrow(ValidationError);
  });

  it("rejects a TEXT question carrying an imageKey", () => {
    expect(() => parseQuestionInputs([text({ imageKey: "images/x.png" })], MAX)).toThrow(
      /must not carry an imageKey/,
    );
  });

  it("rejects a PICTURE_10 question with no imageKey", () => {
    expect(() => parseQuestionInputs([picture({ imageKey: undefined })], MAX)).toThrow(
      /needs an imageKey/,
    );
  });

  it("rejects a PICTURE_10 question without exactly ten answers", () => {
    expect(() => parseQuestionInputs([picture({ correctAnswers: ["a"] })], MAX)).toThrow(
      /exactly 10 correct answers, got 1/,
    );
    expect(() =>
      parseQuestionInputs([picture({ correctAnswers: Array(11).fill("a") })], MAX),
    ).toThrow(/got 11/);
  });

  it("rejects empty or non-string answers", () => {
    expect(() => parseQuestionInputs([text({ correctAnswers: [" "] })], MAX)).toThrow(
      /must not contain empty strings/,
    );
    expect(() => parseQuestionInputs([text({ correctAnswers: [7] })], MAX)).toThrow(
      /array of strings/,
    );
    expect(() => parseQuestionInputs([text({ correctAnswers: [] })], MAX)).toThrow(ValidationError);
  });

  it("rejects a bad question type", () => {
    expect(() => parseQuestionInputs([text({ type: "AUDIO" })], MAX)).toThrow(
      /TEXT or PICTURE_10/,
    );
  });

  it("rejects non-positive or fractional points", () => {
    expect(() => parseQuestionInputs([text({ defaultPoints: 0 })], MAX)).toThrow(
      /positive integer/,
    );
    expect(() => parseQuestionInputs([text({ defaultPoints: 1.5 })], MAX)).toThrow(
      /positive integer/,
    );
  });

  it("rejects a non-array, an empty round and an over-long round", () => {
    expect(() => parseQuestionInputs("nope", MAX)).toThrow(/must be an array/);
    expect(() => parseQuestionInputs([], MAX)).toThrow(/at least one question/);
    expect(() => parseQuestionInputs(Array.from({ length: 100 }, () => text()), MAX)).toThrow(
      /at most 99 questions/,
    );
  });

  it("rejects an entry that is not an object", () => {
    expect(() => parseQuestionInputs(["nope"], MAX)).toThrow(/must be an object/);
  });
});
