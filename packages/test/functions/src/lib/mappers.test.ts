import { describe, expect, it } from "vitest";
import { ValidationError } from "@know-it-owl/functions/lib/errors";
import * as keys from "@know-it-owl/functions/lib/keys";
import {
  mapItems,
  toGame,
  toPlayer,
  toQuestion,
  toRound,
  toTeam,
  toTeamResponse,
  type GameMetaItem,
  type PlayerItem,
  type QuestionItem,
  type ResponseItem,
  type RoundItem,
  type TeamItem,
} from "@know-it-owl/functions/lib/mappers";

const gameMeta: GameMetaItem = {
  ...keys.gameMeta("g1"),
  status: "LOBBY",
  gmTokenHash: "hash",
  joinCode: "ABC123",
  currentRound: null,
  createdAt: "2026-08-29T00:00:00.000Z",
};

describe("mappers", () => {
  it("maps the game meta item, dropping the token hash", () => {
    expect(toGame(gameMeta)).toEqual({
      id: "g1",
      joinCode: "ABC123",
      status: "LOBBY",
      currentRound: null,
    });
    expect(JSON.stringify(toGame(gameMeta))).not.toContain("hash");
  });

  it("maps players and teams, recovering ids from the sort key", () => {
    const playerItem: PlayerItem = {
      ...keys.player("g1", "p1"),
      displayName: "Ada",
      teamId: "t1",
    };
    expect(toPlayer(playerItem)).toEqual({ id: "p1", displayName: "Ada", teamId: "t1" });

    const teamItem: TeamItem = {
      ...keys.team("g1", "t1"),
      name: "Owls",
      score: 7,
      doubleUsedRound: 2,
      lastSubmittedRound: 1,
    };
    expect(toTeam(teamItem)).toEqual({
      id: "t1",
      name: "Owls",
      score: 7,
      doubleUsedRound: 2,
      lastSubmittedRound: 1,
    });
  });

  it("maps rounds and questions", () => {
    const roundItem: RoundItem = {
      ...keys.round("g1", 3),
      category: "Film",
      status: "ACTIVE",
      doublingAllowed: true,
      releasedCount: 2,
    };
    expect(toRound(roundItem)).toEqual({
      number: 3,
      category: "Film",
      status: "ACTIVE",
      doublingAllowed: true,
      releasedCount: 2,
    });

    const questionItem: QuestionItem = {
      ...keys.question("g1", 12, 4),
      type: "PICTURE_10",
      imageKey: "images/g1/a.png",
      correctAnswers: ["a"],
      defaultPoints: 10,
    };
    expect(toQuestion(questionItem)).toEqual({
      roundNumber: 12,
      number: 4,
      type: "PICTURE_10",
      imageKey: "images/g1/a.png",
      correctAnswers: ["a"],
      defaultPoints: 10,
    });
    expect(toQuestion(questionItem)).not.toHaveProperty("text");
  });

  it("maps team responses including the team id after the TEAM segment", () => {
    const responseItem: ResponseItem = {
      ...keys.response("g1", 2, 5, "team-uuid"),
      answers: ["one"],
      doubled: true,
      graded: false,
      gradedPoints: null,
    };
    expect(toTeamResponse(responseItem)).toEqual({
      roundNumber: 2,
      questionNumber: 5,
      teamId: "team-uuid",
      answers: ["one"],
      doubled: true,
      graded: false,
      gradedPoints: null,
    });
  });

  it("throws ValidationError when an attribute has the wrong type", () => {
    expect(() => toTeam({ ...keys.team("g1", "t1"), name: "Owls", score: "7" })).toThrow(
      ValidationError,
    );
    expect(() =>
      toGame({ ...gameMeta, status: "NOT_A_STATUS" as unknown as GameMetaItem["status"] }),
    ).toThrow(/invalid "status"/);
    expect(() =>
      toTeamResponse({
        ...keys.response("g1", 1, 1, "t1"),
        answers: ["a", 2],
        doubled: false,
        graded: false,
        gradedPoints: null,
      }),
    ).toThrow(/invalid "answers"/);
  });

  it("throws ValidationError when a required attribute is missing", () => {
    expect(() => toPlayer({ ...keys.player("g1", "p1") })).toThrow(/invalid "displayName"/);
  });

  it("treats a missing nullable attribute as null", () => {
    expect(toTeam({ ...keys.team("g1", "t1"), name: "Owls", score: 0 }).doubleUsedRound).toBeNull();
    expect(toPlayer({ ...keys.player("g1", "p1"), displayName: "Ada" }).teamId).toBeNull();
  });

  it("throws ValidationError on a sort key of the wrong kind", () => {
    const wrong = { ...keys.team("g1", "t1"), displayName: "Ada", teamId: null };
    expect(() => toPlayer(wrong)).toThrow(ValidationError);
    expect(() => toRound({ ...keys.gameMeta("g1"), category: "x", status: "DRAFT" })).toThrow(
      ValidationError,
    );
  });

  it("filters a mixed partition by prefix", () => {
    const items = [
      gameMeta,
      { ...keys.player("g1", "p1"), displayName: "Ada", teamId: null },
      { ...keys.player("g1", "p2"), displayName: "Bo", teamId: null },
      { ...keys.team("g1", "t1"), name: "Owls", score: 0, doubleUsedRound: null },
    ];
    const players = mapItems(items, keys.prefixes.players(), toPlayer);
    expect(players.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});
