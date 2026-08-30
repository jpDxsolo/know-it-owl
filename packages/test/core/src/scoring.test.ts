import { describe, expect, it } from "vitest";
import type { TeamResponse } from "@know-it-owl/core";
import { sumRoundPoints, sumRoundPointsByTeam } from "@know-it-owl/core";

function response(overrides: Partial<TeamResponse> = {}): TeamResponse {
  return {
    roundNumber: 1,
    questionNumber: 1,
    teamId: "t1",
    answers: ["Paris"],
    doubled: false,
    graded: true,
    gradedPoints: [1],
    ...overrides,
  };
}

describe("sumRoundPoints", () => {
  it("adds the points the GM entered", () => {
    expect(
      sumRoundPoints([
        response({ questionNumber: 1, gradedPoints: [2] }),
        response({ questionNumber: 2, gradedPoints: [3] }),
      ]),
    ).toBe(5);
  });

  it("adds every entry of a multi-part question", () => {
    expect(sumRoundPoints([response({ gradedPoints: [1, 0, 1, 1, 0, 1, 1, 1, 0, 1] })])).toBe(7);
  });

  it("does not multiply a doubled team's points", () => {
    const plain = sumRoundPoints([response({ doubled: false, gradedPoints: [4] })]);
    const doubled = sumRoundPoints([response({ doubled: true, gradedPoints: [4] })]);
    expect(doubled).toBe(4);
    expect(doubled).toBe(plain);
  });

  it("ignores responses that have not been graded", () => {
    expect(
      sumRoundPoints([
        response({ questionNumber: 1, gradedPoints: [5] }),
        response({ questionNumber: 2, graded: false, gradedPoints: null }),
        response({ questionNumber: 3, graded: false, gradedPoints: [99] }),
      ]),
    ).toBe(5);
  });

  it("is zero for no responses", () => {
    expect(sumRoundPoints([])).toBe(0);
  });
});

describe("sumRoundPointsByTeam", () => {
  it("totals each team separately", () => {
    const totals = sumRoundPointsByTeam([
      response({ teamId: "t1", questionNumber: 1, gradedPoints: [2] }),
      response({ teamId: "t1", questionNumber: 2, gradedPoints: [1] }),
      response({ teamId: "t2", questionNumber: 1, gradedPoints: [5] }),
    ]);
    expect(totals.get("t1")).toBe(3);
    expect(totals.get("t2")).toBe(5);
  });

  it("omits a team that submitted nothing rather than reporting zero", () => {
    const totals = sumRoundPointsByTeam([response({ teamId: "t1" })]);
    expect(totals.has("t2")).toBe(false);
  });
});
