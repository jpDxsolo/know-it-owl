import { describe, expect, it } from "vitest";
import { newGameId, newGmToken, newJoinCode, newTeamId } from "./ids.js";

describe("id generators", () => {
  it("generates distinct uuid game and team ids", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(newGameId()).toMatch(uuid);
    expect(newTeamId()).toMatch(uuid);
    expect(newGameId()).not.toEqual(newGameId());
  });

  it("generates join codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = newJoinCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
    }
  });

  it("honours a requested join-code length", () => {
    expect(newJoinCode(4)).toHaveLength(4);
  });

  it("generates url-safe gm tokens that differ each call", () => {
    const token = newGmToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(newGmToken()).not.toEqual(token);
  });
});
