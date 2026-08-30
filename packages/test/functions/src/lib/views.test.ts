import { describe, expect, it } from "vitest";
import type { Game, Player, Team } from "@know-it-owl/core";
import { assembleGame } from "@know-it-owl/functions/lib/views";

const game: Game = { id: "g1", joinCode: "ABC123", status: "TEAMS_SET", currentRound: null };

const players: Player[] = [
  { id: "p1", displayName: "Ada", teamId: "t1" },
  { id: "p2", displayName: "Bo", teamId: "t2" },
  { id: "p3", displayName: "Cy", teamId: "t1" },
  { id: "p4", displayName: "Dee", teamId: null },
];

const teams: Team[] = [
  { id: "t1", name: "Owls", score: 3, doubleUsedRound: null },
  { id: "t2", name: "Hawks", score: 5, doubleUsedRound: 2 },
];

describe("assembleGame", () => {
  it("groups players onto their teams", () => {
    const view = assembleGame(game, players, teams);
    expect(view.teams.map((team) => team.players.map((player) => player.id))).toEqual([
      ["p1", "p3"],
      ["p2"],
    ]);
  });

  it("keeps unassigned players on the game roster", () => {
    const view = assembleGame(game, players, teams);
    expect(view.players).toHaveLength(4);
    expect(view.teams.flatMap((team) => team.players)).toHaveLength(3);
  });

  it("carries the game fields through", () => {
    const view = assembleGame(game, [], []);
    expect(view).toMatchObject({ id: "g1", joinCode: "ABC123", status: "TEAMS_SET" });
  });
});
