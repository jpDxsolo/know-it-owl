import { describe, expect, it } from "vitest";
import { mergeGameSnapshot, type Game } from "@know-it-owl/frontend/hooks/useGame";
import type { GameUpdateEvent } from "@know-it-owl/frontend/services/realtime";

function question(number: number, overrides: Partial<Game["rounds"][number]["questions"][number]> = {}) {
  return {
    number,
    type: "TEXT" as const,
    text: `Question ${number}`,
    imageUrl: null,
    defaultPoints: 1,
    correctAnswers: null,
    ...overrides,
  };
}

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "g1",
    joinCode: "ABC123",
    status: "LOBBY",
    currentRound: null,
    players: [],
    teams: [],
    rounds: [],
    ...overrides,
  };
}

function event(name: string, overrides: Partial<Game> = {}): GameUpdateEvent {
  const snapshot = game(overrides);
  return {
    gameId: snapshot.id,
    status: snapshot.status,
    currentRound: snapshot.currentRound,
    event: name,
    player: null,
    game: snapshot,
  };
}

/** What a player sees mid-round: the started round, only released questions. */
const PLAYER_ROUNDS: Game["rounds"] = [
  {
    number: 1,
    category: "Capitals",
    status: "ACTIVE",
    releasedCount: 1,
    questions: [question(1)],
  },
];

/** What the GM sees at the same moment: everything, plus a round still in draft. */
const GM_ROUNDS: Game["rounds"] = [
  {
    number: 1,
    category: "Capitals",
    status: "ACTIVE",
    releasedCount: 1,
    questions: [question(1), question(2), question(3)],
  },
  {
    number: 2,
    category: "Secret Round",
    status: "DRAFT",
    releasedCount: 0,
    questions: [question(1)],
  },
];

describe("mergeGameSnapshot as a player", () => {
  it("takes the broadcast wholesale — it is the truth for this viewer", () => {
    const incoming = event("PLAYER_JOINED", {
      players: [{ id: "p1", displayName: "Ada", teamId: null }],
    });

    const merged = mergeGameSnapshot(undefined, incoming, "PLAYER");
    expect(merged.game.players).toHaveLength(1);
    expect(merged.staleRounds).toBe(false);
  });

  it("replaces rounds rather than merging them", () => {
    // A released question must be able to *appear*, and a round must be able to
    // change status, so the incoming list wins outright.
    const current = game({ rounds: [] });
    const incoming = event("QUESTION_RELEASED", { rounds: PLAYER_ROUNDS });

    const merged = mergeGameSnapshot(current, incoming, "PLAYER");
    expect(merged.game.rounds).toEqual(PLAYER_ROUNDS);
  });
});

describe("mergeGameSnapshot as the GM", () => {
  /**
   * The subtle one. A GameUpdate goes to everyone, so it is always a *player*
   * snapshot — no DRAFT rounds, no unreleased questions. Taking it wholesale
   * would blank the GM's authoring view every time a player did anything.
   */
  it("keeps the wider rounds when a player joins", () => {
    const current = game({ rounds: GM_ROUNDS });
    const incoming = event("PLAYER_JOINED", {
      players: [{ id: "p1", displayName: "Ada", teamId: null }],
      rounds: PLAYER_ROUNDS,
    });

    const merged = mergeGameSnapshot(current, incoming, "GM");

    expect(merged.game.rounds).toEqual(GM_ROUNDS);
    expect(merged.game.rounds[1].category).toBe("Secret Round");
    expect(merged.game.rounds[0].questions).toHaveLength(3);
    // But everything that is the same for both viewers still updates.
    expect(merged.game.players).toHaveLength(1);
    expect(merged.staleRounds).toBe(false);
  });

  it.each(["TEAMS_SET", "TEAM_RENAMED", "DOUBLE_CHOSEN", "ANSWERS_SUBMITTED", "PLAYER_JOINED"])(
    "does not ask for a re-read after %s, which cannot change a round",
    (name) => {
      const merged = mergeGameSnapshot(game({ rounds: GM_ROUNDS }), event(name), "GM");
      expect(merged.staleRounds).toBe(false);
    },
  );

  it.each(["ROUND_STARTED", "QUESTION_RELEASED", "ROUND_REVEALED"])(
    "asks for a re-read after %s, which does",
    (name) => {
      const merged = mergeGameSnapshot(game({ rounds: GM_ROUNDS }), event(name), "GM");
      // The kept rounds are now stale — a re-read with the token reconciles them.
      expect(merged.staleRounds).toBe(true);
    },
  );

  it("takes the player view when it has nothing, and asks to re-read at once", () => {
    // An event can arrive before the first query resolves. A narrow snapshot
    // beats a blank screen, but it must not be mistaken for the GM view.
    const merged = mergeGameSnapshot(undefined, event("PLAYER_JOINED", { rounds: PLAYER_ROUNDS }), "GM");

    expect(merged.game.rounds).toEqual(PLAYER_ROUNDS);
    expect(merged.staleRounds).toBe(true);
  });

  it("never mutates the snapshot it was given", () => {
    const current = game({ rounds: GM_ROUNDS });
    const before = structuredClone(current);

    mergeGameSnapshot(current, event("ROUND_STARTED", { rounds: PLAYER_ROUNDS }), "GM");

    expect(current).toEqual(before);
  });
});
