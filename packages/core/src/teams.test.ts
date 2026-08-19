import { describe, expect, it } from "vitest";
import { randomizeTeams } from "./teams.js";

const players = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Simple deterministic LCG for reproducible shuffles. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("randomizeTeams", () => {
  it("splits 20 players into 3 teams of 7, 7, 6", () => {
    const teams = randomizeTeams(players(20), 3);
    expect(teams.map((t) => t.length)).toEqual([7, 7, 6]);
  });

  it("splits evenly when divisible (12 / 4 -> 3 each)", () => {
    const teams = randomizeTeams(players(12), 4);
    expect(teams.map((t) => t.length)).toEqual([3, 3, 3, 3]);
  });

  it("assigns every player exactly once", () => {
    const input = players(17);
    const teams = randomizeTeams(input, 5);
    const all = teams.flat().sort();
    expect(all).toEqual([...input].sort());
  });

  it("team sizes never differ by more than 1", () => {
    for (let n = 2; n <= 30; n++) {
      for (let t = 1; t <= Math.min(n, 8); t++) {
        const sizes = randomizeTeams(players(n), t).map((x) => x.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("produces different assignments for different seeds", () => {
    const input = players(20);
    const a = randomizeTeams(input, 3, seededRandom(1));
    const b = randomizeTeams(input, 3, seededRandom(42));
    expect(a).not.toEqual(b);
  });

  it("is deterministic for the same seed", () => {
    const input = players(20);
    const a = randomizeTeams(input, 3, seededRandom(7));
    const b = randomizeTeams(input, 3, seededRandom(7));
    expect(a).toEqual(b);
  });

  it("rejects invalid team counts", () => {
    expect(() => randomizeTeams(players(4), 0)).toThrow();
    expect(() => randomizeTeams(players(4), 5)).toThrow();
  });
});
