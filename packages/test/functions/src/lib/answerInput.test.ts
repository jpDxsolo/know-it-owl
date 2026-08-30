import { describe, expect, it } from "vitest";
import type { Question } from "@know-it-owl/core";
import { ValidationError } from "@know-it-owl/functions/lib/errors";
import { expectedAnswerCount, parseAnswerInputs } from "@know-it-owl/functions/lib/answerInput";

function textQuestion(number: number): Question {
  return {
    roundNumber: 1,
    number,
    type: "TEXT",
    text: `Q${number}`,
    correctAnswers: ["a"],
    defaultPoints: 1,
  };
}

function pictureQuestion(number: number): Question {
  return {
    roundNumber: 1,
    number,
    type: "PICTURE_10",
    imageKey: "images/g1/birds.png",
    correctAnswers: Array.from({ length: 10 }, (_, i) => `a${i}`),
    defaultPoints: 10,
  };
}

const questions = [textQuestion(1), pictureQuestion(2)];
const tenAnswers = Array.from({ length: 10 }, (_, i) => `bird ${i}`);

const complete = [
  { questionNumber: 1, answers: ["Paris"] },
  { questionNumber: 2, answers: tenAnswers },
];

describe("expectedAnswerCount", () => {
  it("is one for TEXT and ten for PICTURE_10", () => {
    expect(expectedAnswerCount(textQuestion(1))).toBe(1);
    expect(expectedAnswerCount(pictureQuestion(1))).toBe(10);
  });
});

describe("parseAnswerInputs", () => {
  it("accepts full coverage and returns it ordered by question", () => {
    const parsed = parseAnswerInputs([complete[1], complete[0]], questions);
    expect(parsed.map((entry) => entry.questionNumber)).toEqual([1, 2]);
    expect(parsed[0].answers).toEqual(["Paris"]);
    expect(parsed[1].answers).toHaveLength(10);
  });

  it("trims answers but keeps blanks", () => {
    const parsed = parseAnswerInputs(
      [{ questionNumber: 1, answers: ["  Paris  "] }, complete[1]],
      questions,
    );
    expect(parsed[0].answers).toEqual(["Paris"]);

    const blank = parseAnswerInputs(
      [{ questionNumber: 1, answers: ["   "] }, complete[1]],
      questions,
    );
    expect(blank[0].answers).toEqual([""]);
  });

  it("rejects a missing question", () => {
    expect(() => parseAnswerInputs([complete[0]], questions)).toThrow(/Question 2 has no answer/);
  });

  it("rejects a question that is not in the round", () => {
    expect(() =>
      parseAnswerInputs([...complete, { questionNumber: 3, answers: ["x"] }], questions),
    ).toThrow(/Question 3 is not in this round/);
  });

  it("rejects the same question answered twice", () => {
    expect(() => parseAnswerInputs([complete[0], complete[0], complete[1]], questions)).toThrow(
      /answered twice/,
    );
  });

  it("enforces one answer for TEXT", () => {
    expect(() =>
      parseAnswerInputs([{ questionNumber: 1, answers: ["a", "b"] }, complete[1]], questions),
    ).toThrow(/Question 1 needs exactly 1 answer, got 2/);
  });

  it("enforces ten answers for PICTURE_10", () => {
    expect(() =>
      parseAnswerInputs(
        [complete[0], { questionNumber: 2, answers: tenAnswers.slice(0, 9) }],
        questions,
      ),
    ).toThrow(/Question 2 needs exactly 10 answers, got 9/);
  });

  it("rejects malformed entries", () => {
    expect(() => parseAnswerInputs("nope", questions)).toThrow(/must be an array/);
    expect(() => parseAnswerInputs(["nope"], questions)).toThrow(/must be an object/);
    expect(() => parseAnswerInputs([{ answers: ["a"] }], questions)).toThrow(
      /"questionNumber" must be an integer/,
    );
    expect(() => parseAnswerInputs([{ questionNumber: 1, answers: "Paris" }], questions)).toThrow(
      ValidationError,
    );
    expect(() => parseAnswerInputs([{ questionNumber: 1, answers: [7] }], questions)).toThrow(
      /array of strings/,
    );
  });
});
