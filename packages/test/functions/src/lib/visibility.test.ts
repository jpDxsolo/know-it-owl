import { describe, expect, it } from "vitest";
import type { Question, Round } from "@know-it-owl/core";
import { hashGmToken } from "@know-it-owl/functions/lib/gmAuth";
import {
  isAnswerKeyVisible,
  isRoundVisible,
  viewerRole,
  visibleQuestion,
  visibleRound,
  visibleRounds,
} from "@know-it-owl/functions/lib/visibility";

const TOKEN = "s3cret-token";
const HASH = hashGmToken(TOKEN);

function question(roundNumber: number, number: number): Question {
  return {
    roundNumber,
    number,
    type: "TEXT",
    text: `Q${number}?`,
    correctAnswers: [`A${number}`],
    defaultPoints: 1,
  };
}

const rounds: Round[] = [
  { number: 1, category: "History", status: "REVEALED" },
  { number: 2, category: "Music", status: "ACTIVE" },
  { number: 3, category: "Surprise", status: "DRAFT" },
];

const questions = [question(1, 1), question(2, 1), question(2, 2), question(3, 1)];

describe("viewerRole", () => {
  it("is GM for a token matching the stored hash", () => {
    expect(viewerRole(TOKEN, HASH)).toBe("GM");
  });

  it("is PLAYER for a wrong token rather than throwing", () => {
    expect(viewerRole("wrong", HASH)).toBe("PLAYER");
  });

  it("is PLAYER when either side is missing", () => {
    expect(viewerRole(undefined, HASH)).toBe("PLAYER");
    expect(viewerRole(TOKEN, undefined)).toBe("PLAYER");
  });
});

describe("isRoundVisible", () => {
  it("hides DRAFT rounds from players only", () => {
    expect(isRoundVisible("DRAFT", "PLAYER")).toBe(false);
    expect(isRoundVisible("DRAFT", "GM")).toBe(true);
  });

  it("shows every started round to players", () => {
    for (const status of ["ACTIVE", "GRADING", "REVEALED"] as const) {
      expect(isRoundVisible(status, "PLAYER")).toBe(true);
    }
  });
});

describe("isAnswerKeyVisible", () => {
  it("withholds the key from players until the round is revealed", () => {
    expect(isAnswerKeyVisible("ACTIVE", "PLAYER")).toBe(false);
    expect(isAnswerKeyVisible("GRADING", "PLAYER")).toBe(false);
    expect(isAnswerKeyVisible("REVEALED", "PLAYER")).toBe(true);
  });

  it("always shows the key to the GM", () => {
    for (const status of ["DRAFT", "ACTIVE", "GRADING", "REVEALED"] as const) {
      expect(isAnswerKeyVisible(status, "GM")).toBe(true);
    }
  });
});

describe("visibleQuestion", () => {
  it("nulls the answer key for a player mid-round", () => {
    const result = visibleQuestion(question(2, 1), "ACTIVE", "PLAYER");
    expect(result.correctAnswers).toBeNull();
    expect(result.text).toBe("Q1?");
  });

  it("returns the key once revealed", () => {
    expect(visibleQuestion(question(1, 1), "REVEALED", "PLAYER").correctAnswers).toEqual(["A1"]);
  });

  it("copies the key rather than aliasing the source array", () => {
    const source = question(1, 1);
    const result = visibleQuestion(source, "REVEALED", "GM");
    result.correctAnswers?.push("tampered");
    expect(source.correctAnswers).toEqual(["A1"]);
  });
});

describe("visibleRound", () => {
  it("hides an unreleased round entirely, including its category", () => {
    expect(visibleRound(rounds[2], questions, "PLAYER")).toBeUndefined();
  });

  it("takes only the questions belonging to the round", () => {
    const result = visibleRound(rounds[1], questions, "PLAYER");
    expect(result?.questions.map((q) => q.number)).toEqual([1, 2]);
  });
});

describe("visibleRounds", () => {
  it("drops unreleased rounds and strips unrevealed keys for players", () => {
    const result = visibleRounds(rounds, questions, "PLAYER");
    expect(result.map((round) => round.number)).toEqual([1, 2]);
    expect(result[0].questions[0].correctAnswers).toEqual(["A1"]);
    expect(result[1].questions.every((q) => q.correctAnswers === null)).toBe(true);
  });

  it("gives the GM every round and every key", () => {
    const result = visibleRounds(rounds, questions, "GM");
    expect(result.map((round) => round.number)).toEqual([1, 2, 3]);
    expect(result.flatMap((round) => round.questions).every((q) => q.correctAnswers)).toBe(true);
  });
});
