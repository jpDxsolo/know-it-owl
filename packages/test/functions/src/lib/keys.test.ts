import { describe, expect, it } from "vitest";
import * as keys from "@know-it-owl/functions/lib/keys";

describe("key builders", () => {
  it("builds the game meta key", () => {
    expect(keys.gameMeta("g1")).toEqual({ pk: "GAME#g1", sk: "META" });
  });

  it("builds player, team and round keys", () => {
    expect(keys.player("g1", "p1")).toEqual({ pk: "GAME#g1", sk: "PLAYER#p1" });
    expect(keys.team("g1", "t1")).toEqual({ pk: "GAME#g1", sk: "TEAM#t1" });
    expect(keys.round("g1", 2)).toEqual({ pk: "GAME#g1", sk: "ROUND#2" });
  });

  it("builds question and response keys matching the data model", () => {
    expect(keys.question("g1", 2, 3)).toEqual({ pk: "GAME#g1", sk: "ROUND#2#Q#3" });
    expect(keys.response("g1", 2, 3, "t1")).toEqual({
      pk: "GAME#g1",
      sk: "RESP#2#3#TEAM#t1",
    });
  });

  it("builds the join-code lookup key in its own partition", () => {
    expect(keys.joinCode("ABC123")).toEqual({ pk: "JOINCODE#ABC123", sk: "META" });
  });

  it("builds query prefixes that match the corresponding keys", () => {
    expect(keys.player("g1", "p1").sk.startsWith(keys.prefixes.players())).toBe(true);
    expect(keys.team("g1", "t1").sk.startsWith(keys.prefixes.teams())).toBe(true);
    expect(keys.round("g1", 4).sk.startsWith(keys.prefixes.rounds())).toBe(true);
    expect(keys.question("g1", 4, 1).sk.startsWith(keys.prefixes.questions(4))).toBe(true);
    expect(keys.response("g1", 4, 1, "t1").sk.startsWith(keys.prefixes.responses(4))).toBe(true);
    expect(
      keys.response("g1", 4, 1, "t1").sk.startsWith(keys.prefixes.questionResponses(4, 1)),
    ).toBe(true);
  });

  it("does not match a sibling round with the same prefix digits", () => {
    expect(keys.question("g1", 12, 1).sk.startsWith(keys.prefixes.questions(1))).toBe(false);
  });
});
