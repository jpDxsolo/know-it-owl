import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@know-it-owl/frontend/hooks/useGame";
import { TeamRound } from "@know-it-owl/frontend/screens/TeamRound";
import { setApiConfig } from "@know-it-owl/frontend/services/config";
import { roundDraft, saveRoundDraft } from "@know-it-owl/frontend/services/drafts";

/** A socket that connects to nothing, for the tests that do not drive events. */
class InertSocket {
  onopen: (() => void) | undefined;
  onmessage: ((event: MessageEvent<string>) => void) | undefined;
  onclose: (() => void) | undefined;
  onerror: (() => void) | undefined;
  readyState = 0;
  send(): void {}
  close(): void {}
}

/** A socket the test holds on to, so a broadcast can be delivered by hand. */
const sockets: InertSocket[] = [];
class DrivableSocket extends InertSocket {
  constructor() {
    super();
    sockets.push(this);
  }
}

const ME = "p1";
let calls: { query: string; variables: Record<string, unknown> }[] = [];

function player(id: string, displayName: string, teamId: string | null = null) {
  return { id, displayName, teamId };
}

function team(
  id: string,
  name: string,
  members: ReturnType<typeof player>[],
  overrides: { score?: number; doubleUsedRound?: number | null; lastSubmittedRound?: number | null } = {},
) {
  return {
    id,
    name,
    score: overrides.score ?? 0,
    doubleUsedRound: overrides.doubleUsedRound ?? null,
    lastSubmittedRound: overrides.lastSubmittedRound ?? null,
    players: members,
  };
}

function question(number: number, text = `Question ${number}`) {
  return {
    number,
    type: "TEXT" as const,
    text,
    imageUrl: null,
    defaultPoints: 2,
    correctAnswers: null,
  };
}

function picture(number: number) {
  return {
    number,
    type: "PICTURE_10" as const,
    text: null,
    imageUrl: "https://images.test/one.jpg",
    defaultPoints: 1,
    correctAnswers: null,
  };
}

const ada = player(ME, "Ada", "t1");
const grace = player("p2", "Grace", "t1");
const alan = player("p3", "Alan", "t2");

/**
 * A game mid-round: two teams, five questions authored, `released` of them out.
 * The player view only ever carries the released ones, so the fixture drops the
 * rest exactly as the server would.
 */
function playing(
  released: number,
  overrides: {
    questionCount?: number;
    teamOverrides?: Parameters<typeof team>[3];
    questions?: (ReturnType<typeof question> | ReturnType<typeof picture>)[];
    roundStatus?: "ACTIVE" | "GRADING";
    status?: Game["status"];
  } = {},
): Game {
  const authored = overrides.questions ?? [1, 2, 3, 4, 5].map((n) => question(n));
  const questionCount = overrides.questionCount ?? authored.length;
  return {
    id: "g1",
    joinCode: "ABC123",
    status: overrides.status ?? "ROUND_ACTIVE",
    currentRound: 1,
    players: [ada, grace, alan],
    teams: [
      team("t1", "The Night Owls", [ada, grace], { score: 24, ...overrides.teamOverrides }),
      team("t2", "Bears", [alan], { score: 31 }),
    ],
    rounds: [
      {
        number: 1,
        category: "Capitals",
        status: overrides.roundStatus ?? "ACTIVE",
        releasedCount: released,
        questionCount,
        questions: authored.filter((entry) => entry.number <= released),
      },
    ],
  };
}

function serve(snapshot: Game): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      calls.push(body);
      if (body.query.includes("query Game")) {
        return { ok: true, status: 200, json: async () => ({ data: { game: snapshot } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { submitAnswers: null } }) };
    }),
  );
}

function renderRound() {
  return render(
    <MemoryRouter initialEntries={["/game/g1/round"]}>
      <Routes>
        <Route path="/game/:gameId/round" element={<TeamRound />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Push a snapshot down the subscription the screen opened. */
function broadcast(snapshot: Game, event: string): void {
  const socket = sockets[0];
  socket.readyState = 1;
  socket.onopen?.();
  socket.onmessage?.({
    data: JSON.stringify({ type: "connection_ack", payload: { connectionTimeoutMs: 300000 } }),
  } as MessageEvent<string>);
  socket.onmessage?.({ data: JSON.stringify({ type: "start_ack" }) } as MessageEvent<string>);
  socket.onmessage?.({
    data: JSON.stringify({
      type: "data",
      payload: {
        data: {
          onGameUpdated: {
            gameId: "g1",
            status: snapshot.status,
            currentRound: snapshot.currentRound,
            event,
            player: null,
            game: snapshot,
          },
        },
      },
    }),
  } as MessageEvent<string>);
}

beforeEach(() => {
  calls = [];
  sockets.length = 0;
  localStorage.clear();
  localStorage.setItem("kio.playerId", ME);
  setApiConfig({ url: "https://api.test/graphql", realtimeUrl: "wss://rt.test", apiKey: "da2-x" });
  vi.stubGlobal("WebSocket", DrivableSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setApiConfig(undefined);
  localStorage.clear();
});

describe("what the team can see", () => {
  it("shows the round, their team and the standings", async () => {
    serve(playing(1));
    renderRound();

    await waitFor(() => expect(screen.getByText("Capitals")).toBeInTheDocument());
    expect(screen.getByText("Round 1")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("Bears")).toBeInTheDocument();
    // Second of two on 24 points, behind the Bears' 31.
    expect(screen.getByText(/2nd of 2 · 24 pts/)).toBeInTheDocument();
  });

  it("opens and closes the context panel on a phone", async () => {
    serve(playing(1));
    renderRound();
    await waitFor(() => expect(screen.getByText("Capitals")).toBeInTheDocument());

    const toggle = screen.getByRole("button", { expanded: false });
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("waits quietly before the first question is out", async () => {
    serve(playing(0));
    renderRound();

    await waitFor(() =>
      expect(screen.getByText(/hasn’t let the first question out yet/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Next question" })).not.toBeInTheDocument();
  });

  it("says when there is no round yet", async () => {
    const waiting = playing(0);
    waiting.currentRound = null;
    serve(waiting);
    renderRound();

    await waitFor(() =>
      expect(screen.getByText(/waiting for your host to start the round/i)).toBeInTheDocument(),
    );
  });

  it("refuses to guess a team for a player who has not been dealt one", async () => {
    const unseated = playing(1);
    unseated.teams = [];
    serve(unseated);
    renderRound();

    await waitFor(() => expect(screen.getByText(/not on a team yet/i)).toBeInTheDocument());
  });
});

describe("paging through the questions", () => {
  it("counts against the whole round, not just what is out", async () => {
    // Players are only sent the released questions, so the total has to come
    // from the round itself or a team could never tell how much is left.
    serve(playing(3));
    renderRound();

    await waitFor(() => expect(screen.getByText("Question 3 of 5")).toBeInTheDocument());
  });

  it("opens on the newest question and will not go past it", async () => {
    serve(playing(3));
    renderRound();

    await waitFor(() => expect(screen.getByText("Question 3 of 5")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Next question" })).toBeDisabled();
  });

  it("goes back to edit an earlier answer, and forward again", async () => {
    serve(playing(3));
    renderRound();
    await waitFor(() => expect(screen.getByText("Question 3 of 5")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Previous question" }));
    expect(screen.getByText("Question 2 of 5")).toBeInTheDocument();
    expect(screen.getByText("Question 2")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText("Question 3 of 5")).toBeInTheDocument();
  });

  it("jumps straight to a question from the strip, but not to a locked one", async () => {
    serve(playing(3));
    renderRound();
    await waitFor(() => expect(screen.getByText("Question 3 of 5")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Question 1" }));
    expect(screen.getByText("Question 1 of 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Question 4, not released yet/ })).toBeDisabled();
  });

  it("follows the host onto a newly released question", async () => {
    serve(playing(2));
    renderRound();
    await waitFor(() => expect(screen.getByText("Question 2 of 5")).toBeInTheDocument());

    broadcast(playing(3), "QUESTION_RELEASED");
    await waitFor(() => expect(screen.getByText("Question 3 of 5")).toBeInTheDocument());
  });

  it("leaves a team alone when they are back editing an earlier answer", async () => {
    // Being yanked off question 1 mid-sentence because the host moved on would
    // lose whatever was being typed from view.
    serve(playing(2));
    renderRound();
    await waitFor(() => expect(screen.getByText("Question 2 of 5")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Question 1" }));
    expect(screen.getByText("Question 1 of 5")).toBeInTheDocument();

    broadcast(playing(3), "QUESTION_RELEASED");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Question 3" })).toBeEnabled(),
    );
    expect(screen.getByText("Question 1 of 5")).toBeInTheDocument();
  });
});

describe("answers and the draft", () => {
  it("keeps what was typed when the team pages away and back", async () => {
    serve(playing(2));
    renderRound();
    await waitFor(() => expect(screen.getByText("Question 2 of 5")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Your answer"), "Canberra");
    await userEvent.click(screen.getByRole("button", { name: "Question 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Question 2" }));

    expect(screen.getByLabelText("Your answer")).toHaveValue("Canberra");
  });

  it("writes the draft to storage, keyed by game and round", async () => {
    serve(playing(2));
    renderRound();
    await waitFor(() => expect(screen.getByText("Question 2 of 5")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Your answer"), "Canberra");
    await waitFor(() => expect(roundDraft("g1", 1)?.answers[2]).toEqual(["Canberra"]));
    expect(roundDraft("g1", 2)).toBeNull();
  });

  it("restores a draft after a reload", async () => {
    saveRoundDraft("g1", 1, { answers: { 1: ["Paris"] }, double: false });
    serve(playing(2));
    renderRound();

    await waitFor(() => expect(screen.getByText("Question 2 of 5")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Question 1" }));
    expect(screen.getByLabelText("Your answer")).toHaveValue("Paris");
  });

  it("gives a picture question ten numbered slots against one image", async () => {
    serve(playing(1, { questions: [picture(1)], questionCount: 1 }));
    renderRound();

    await waitFor(() => expect(screen.getByAltText(/picture round/i)).toBeInTheDocument());
    expect(screen.getAllByRole("textbox")).toHaveLength(10);
    await userEvent.type(screen.getByLabelText("Answer 7"), "Colosseum");
    await waitFor(() =>
      expect(roundDraft("g1", 1)?.answers[1]).toEqual(["", "", "", "", "", "", "Colosseum"]),
    );
  });
});

describe("the double", () => {
  it("is off, and takes nothing until the answers go in", async () => {
    serve(playing(1));
    renderRound();

    await waitFor(() => expect(screen.getByRole("switch")).toBeInTheDocument());
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/nothing is spent until you hand in/i)).toBeInTheDocument();
  });

  it("turns on and is remembered in the draft", async () => {
    serve(playing(1));
    renderRound();
    await waitFor(() => expect(screen.getByRole("switch")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(roundDraft("g1", 1)?.double).toBe(true));
  });

  it("is spent, and says which round took it", async () => {
    serve(playing(1, { teamOverrides: { doubleUsedRound: 3 } }));
    renderRound();

    await waitFor(() => expect(screen.getByRole("switch")).toBeDisabled());
    expect(screen.getByText(/you doubled round 3/i)).toBeInTheDocument();
  });

  it("shows a double already taken for this round as locked in", async () => {
    serve(playing(1, { teamOverrides: { doubleUsedRound: 1 } }));
    renderRound();

    await waitFor(() => expect(screen.getByRole("switch")).toBeDisabled());
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/this round counts twice/i)).toBeInTheDocument();
  });
});

describe("handing in", () => {
  it("stays locked until the host has released every question", async () => {
    serve(playing(4));
    renderRound();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit answers" })).toBeDisabled(),
    );
    expect(screen.getByText("Your host has released 4 of 5 questions.")).toBeInTheDocument();
  });

  it("unlocks on the last release", async () => {
    serve(playing(5));
    renderRound();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit answers" })).toBeEnabled(),
    );
  });

  it("sends one entry per question, blanks included", async () => {
    serve(playing(5));
    renderRound();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit answers" })).toBeEnabled(),
    );

    await userEvent.type(screen.getByLabelText("Your answer"), "Canberra");
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    // Four of five are blank, so the hand-in is confirmed rather than assumed.
    await userEvent.click(screen.getByRole("button", { name: "Hand in" }));

    await waitFor(() => expect(calls.some((c) => c.query.includes("SubmitAnswers"))).toBe(true));
    const sent = calls.find((c) => c.query.includes("SubmitAnswers"))?.variables.input;
    expect(sent).toEqual({
      gameId: "g1",
      playerId: ME,
      roundNumber: 1,
      double: false,
      answers: [
        { questionNumber: 1, answers: [""] },
        { questionNumber: 2, answers: [""] },
        { questionNumber: 3, answers: [""] },
        { questionNumber: 4, answers: [""] },
        { questionNumber: 5, answers: ["Canberra"] },
      ],
    });
  });

  it("confirms a double before spending it, and can be backed out of", async () => {
    serve(playing(5));
    renderRound();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit answers" })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/double is gone for the rest of the game/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.query.includes("SubmitAnswers"))).toBe(false);
  });

  it("carries the double through when it is confirmed", async () => {
    serve(playing(5));
    renderRound();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit answers" })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await userEvent.click(screen.getByRole("button", { name: "Hand in" }));

    await waitFor(() => expect(calls.some((c) => c.query.includes("SubmitAnswers"))).toBe(true));
    const sent = calls.find((c) => c.query.includes("SubmitAnswers"))?.variables.input as {
      double: boolean;
    };
    expect(sent.double).toBe(true);
  });

  it("forgets the draft once the answers belong to the server", async () => {
    saveRoundDraft("g1", 1, { answers: { 1: ["Paris"] }, double: false });
    serve(playing(5));
    renderRound();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit answers" })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await userEvent.click(screen.getByRole("button", { name: "Hand in" }));

    await waitFor(() => expect(roundDraft("g1", 1)).toBeNull());
  });

  it("locks the screen when a teammate hands in from their own phone", async () => {
    // This device never pressed submit; the team's record of having handed in
    // is what closes it, and that arrives with the broadcast.
    serve(playing(5));
    renderRound();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit answers" })).toBeEnabled(),
    );

    broadcast(playing(5, { teamOverrides: { lastSubmittedRound: 1 } }), "ANSWERS_SUBMITTED");

    await waitFor(() =>
      expect(screen.getByText(/one of you handed in for the team/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Handed in" })).toBeDisabled();
    expect(screen.getByLabelText("Your answer")).toBeDisabled();
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("says the host is marking once the round moves on", async () => {
    serve(
      playing(5, {
        roundStatus: "GRADING",
        status: "GRADING",
        teamOverrides: { lastSubmittedRound: 1 },
      }),
    );
    renderRound();

    await waitFor(() => expect(screen.getByText(/your host is marking/i)).toBeInTheDocument());
  });

  it("reports a refusal rather than pretending it went in", async () => {
    serve(playing(5));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { query: string };
        if (body.query.includes("query Game")) {
          return { ok: true, status: 200, json: async () => ({ data: { game: playing(5) } }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            errors: [
              { message: "Your team has already submitted this round", errorType: "ConflictError" },
            ],
          }),
        };
      }),
    );
    renderRound();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Submit answers" })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await userEvent.click(screen.getByRole("button", { name: "Hand in" }));

    await waitFor(() =>
      expect(screen.getByText(/already submitted this round/i)).toBeInTheDocument(),
    );
  });
});
