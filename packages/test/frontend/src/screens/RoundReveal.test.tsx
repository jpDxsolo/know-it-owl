import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@know-it-owl/frontend/hooks/useGame";
import { RoundReveal } from "@know-it-owl/frontend/screens/RoundReveal";
import { setApiConfig } from "@know-it-owl/frontend/services/config";
import { setGmToken } from "@know-it-owl/frontend/services/identity";

class InertSocket {
  onopen: (() => void) | undefined;
  onmessage: ((event: MessageEvent<string>) => void) | undefined;
  onclose: (() => void) | undefined;
  onerror: (() => void) | undefined;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const ME = "p1";

function player(id: string, displayName: string, teamId: string | null = null) {
  return { id, displayName, teamId };
}

function team(id: string, name: string, score: number, members: ReturnType<typeof player>[]) {
  return { id, name, score, doubleUsedRound: null, lastSubmittedRound: 1, players: members };
}

const ada = player(ME, "Ada", "t1");
const grace = player("p2", "Grace", "t2");
const teams = [team("t1", "Owls", 24, [ada]), team("t2", "Bears", 31, [grace])];

const game: Game = {
  id: "g1",
  joinCode: "ABC123",
  status: "REVEAL",
  currentRound: 1,
  players: [ada, grace],
  teams,
  rounds: [],
};

/** Widened deliberately: these fixtures carry both question formats. */
interface RevealQuestion {
  number: number;
  type: "TEXT" | "PICTURE_10";
  text: string | null;
  imageUrl: string | null;
  defaultPoints: number;
  correctAnswers: string[] | null;
}

const question: RevealQuestion = {
  number: 1,
  type: "TEXT",
  text: "Which city is the capital of Australia?",
  imageUrl: null,
  defaultPoints: 2,
  correctAnswers: ["Canberra"],
};

function response(
  teamId: string,
  answers: string[],
  gradedPoints: number[] | null,
  doubled = false,
) {
  return {
    roundNumber: 1,
    questionNumber: 1,
    teamId,
    answers,
    doubled,
    graded: gradedPoints !== null,
    gradedPoints,
  };
}

const revealed = {
  round: {
    number: 1,
    category: "Capitals",
    status: "REVEALED",
    releasedCount: 1,
    questionCount: 1,
    doublingAllowed: true,
    questions: [question],
  },
  responses: [response("t1", ["Canberra"], [4], true), response("t2", ["Sydney"], [0])],
  standings: teams,
};

/** Serve the game, and either the results or a refusal for roundResults. */
function serve(results: typeof revealed | "forbidden"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string };
      if (body.query.includes("query RoundResults")) {
        if (results === "forbidden") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              errors: [
                {
                  message: "These results are not public until the round is revealed",
                  errorType: "ForbiddenError",
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: { roundResults: results } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { game } }) };
    }),
  );
}

function renderReveal() {
  return render(
    <MemoryRouter initialEntries={["/game/g1/reveal"]}>
      <Routes>
        <Route path="/game/:gameId/reveal" element={<RoundReveal />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("kio.playerId", ME);
  setApiConfig({ url: "https://api.test/graphql", realtimeUrl: "wss://rt.test", apiKey: "da2-x" });
  vi.stubGlobal("WebSocket", InertSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setApiConfig(undefined);
  localStorage.clear();
});

describe("the host's way onward", () => {
  /** The GM's own view carries DRAFT rounds; a player's never does. */
  const withDraft = {
    ...game,
    rounds: [
      {
        number: 2,
        category: "Music",
        status: "DRAFT" as const,
        releasedCount: 0,
        questionCount: 1,
        doublingAllowed: true,
        questions: [],
      },
    ],
  };

  function serveAs(snapshot: Game): { calls: string[] } {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { query: string };
        calls.push(body.query);
        if (body.query.includes("query RoundResults")) {
          return { ok: true, status: 200, json: async () => ({ data: { roundResults: revealed } }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: { game: snapshot } }) };
      }),
    );
    return { calls };
  }

  it("starts the next round without sending the host hunting for the dashboard", async () => {
    // A reveal is a pause, not an ending: the server starts a round happily
    // from REVEAL. This screen offered nothing, and it is where the host lands
    // the moment they reveal — so the quiz looked finished after one round.
    setGmToken("g1", "token");
    const { calls } = serveAs(withDraft);
    renderReveal();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start round 2/i })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: /start round 2/i }));

    await waitFor(() => expect(calls.some((query) => query.includes("StartRound"))).toBe(true));
  });

  it("sends the host to write one when nothing is drafted", async () => {
    setGmToken("g1", "token");
    serveAs(game);
    renderReveal();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /write the next round/i })).toBeInTheDocument(),
    );
  });

  it("finishes the game, once confirmed", async () => {
    setGmToken("g1", "token");
    const { calls } = serveAs(game);
    renderReveal();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /finish the game/i })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole("button", { name: /finish the game/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/cannot be restarted/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: /finish the game/i }));
    await waitFor(() => expect(calls.some((query) => query.includes("FinishGame"))).toBe(true));
  });

  it("backs out of finishing without sending anything", async () => {
    setGmToken("g1", "token");
    const { calls } = serveAs(game);
    renderReveal();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /finish the game/i })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole("button", { name: /finish the game/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep playing/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls.some((query) => query.includes("FinishGame"))).toBe(false);
  });

  it("offers a tie-breaker when the top of the table is level", async () => {
    // Both on 31, so there is no winner to declare — the host gets the thing
    // they actually want, not a warning buried in the finish dialog.
    setGmToken("g1", "token");
    const level = {
      ...revealed,
      standings: [
        { ...teams[0], score: 31 },
        { ...teams[1], score: 31 },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { query: string };
        if (body.query.includes("query RoundResults")) {
          return { ok: true, status: 200, json: async () => ({ data: { roundResults: level } }) };
        }
        return { ok: true, status: 200, json: async () => ({ data: { game } }) };
      }),
    );
    renderReveal();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /write a tie-breaker/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/owls and bears are level on 31/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /write the next round/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a player none of it", async () => {
    serveAs(withDraft);
    renderReveal();

    await waitFor(() => expect(screen.getByText("Capitals")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /start round/i })).not.toBeInTheDocument();
    expect(screen.getByText(/your host will start the next round/i)).toBeInTheDocument();
  });
});

describe("before the reveal", () => {
  it("says the round is not out yet rather than showing an error", async () => {
    // Arriving a moment early is ordinary; the server refuses, and that refusal
    // is a state to render, not a failure to report.
    serve("forbidden");
    renderReveal();

    await waitFor(() => expect(screen.getByText(/not revealed yet/i)).toBeInTheDocument());
    expect(screen.getByText(/no need to refresh/i)).toBeInTheDocument();
  });
});

describe("the reveal", () => {
  it("shows the round, the key and what each team wrote", async () => {
    serve(revealed);
    renderReveal();

    await waitFor(() => expect(screen.getByText("Capitals")).toBeInTheDocument());
    expect(screen.getByText("Round 1 revealed")).toBeInTheDocument();
    expect(screen.getByText(question.text ?? "")).toBeInTheDocument();
    // Once as the key, once as the Owls' answer.
    expect(screen.getAllByText("Canberra")).toHaveLength(2);
    expect(screen.getByText("Sydney")).toBeInTheDocument();
  });

  it("leads with the viewer's own round total, doubled as the host entered it", async () => {
    // The host typed 4 for a doubled 2-point question. Nothing here multiplies
    // it again — that would double the double.
    serve(revealed);
    renderReveal();

    await waitFor(() => expect(screen.getByText("How your team did")).toBeInTheDocument());
    const mine = screen.getByText("How your team did").closest("section") as HTMLElement;
    expect(within(mine).getByText("4")).toBeInTheDocument();
    expect(within(mine).getByText("points this round")).toBeInTheDocument();
    expect(within(mine).getByText("DOUBLED ×2")).toBeInTheDocument();
  });

  it("ranks the standings highest first and marks the viewer's team", async () => {
    serve(revealed);
    renderReveal();

    await waitFor(() =>
      expect(screen.getByText(/standings after round 1/i)).toBeInTheDocument(),
    );
    const standings = screen.getByText(/standings after round 1/i).closest("section");
    const rows = within(standings as HTMLElement).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Bears");
    expect(rows[0]).toHaveTextContent("31");
    expect(rows[1]).toHaveTextContent("Owls");
    expect(rows[1].className).toContain("kio-reveal__standing--mine");
  });

  it("lets a picture round be opened at full size", async () => {
    serve({
      ...revealed,
      round: {
        ...revealed.round,
        questions: [
          {
            number: 1,
            type: "PICTURE_10",
            text: null,
            imageUrl: "https://images.test/one.jpg",
            defaultPoints: 1,
            correctAnswers: ["a"],
          } satisfies RevealQuestion,
        ],
      },
    });
    renderReveal();

    await waitFor(() => expect(screen.getByAltText(/picture round/i)).toBeInTheDocument());
    const link = screen.getByAltText(/picture round/i).closest("a");
    expect(link).toHaveAttribute("href", "https://images.test/one.jpg");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("gives a picture round's answers their own numbered boxes", async () => {
    // Run together on a line, ten answers to ten numbered things are
    // unreadable — the whole question is which belongs to which.
    const ten = Array.from({ length: 10 }, (_, index) => `Landmark ${index + 1}`);
    serve({
      ...revealed,
      round: {
        ...revealed.round,
        questions: [
          {
            number: 1,
            type: "PICTURE_10",
            text: null,
            imageUrl: "https://images.test/one.jpg",
            defaultPoints: 1,
            correctAnswers: ten,
          } satisfies RevealQuestion,
        ],
      },
      responses: [
        {
          roundNumber: 1,
          questionNumber: 1,
          teamId: "t1",
          // Only the third was right, and it is the third slot that must say so.
          answers: ["", "", "Landmark 3", "", "", "", "", "", "", ""],
          doubled: false,
          graded: true,
          gradedPoints: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
        },
      ],
    });
    renderReveal();

    await waitFor(() => expect(screen.getByText("Landmark 10")).toBeInTheDocument());

    // The key: every answer present, each beside its own number.
    const key = screen.getByText("Correct answers").closest("div") as HTMLElement;
    const rows = within(key).getAllByRole("listitem");
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent("1Landmark 1");
    expect(rows[9]).toHaveTextContent("10Landmark 10");

    // The team's attempt, numbered the same way so it reads straight down.
    // Scoped to the answers, since the standings name every team as well.
    const answers = screen.getByText("The answers").closest("section") as HTMLElement;
    const mine = within(answers).getByText("Owls").closest("li") as HTMLElement;
    const said = within(mine).getAllByRole("listitem");
    expect(said).toHaveLength(10);
    expect(said[2]).toHaveTextContent("3Landmark 3");
    // A blank is still shown, so the numbering never slips.
    expect(said[0]).toHaveTextContent("1—");
  });

  it("shows no double badge for a team that did not double", async () => {
    serve({
      ...revealed,
      responses: [response("t1", ["Canberra"], [2]), response("t2", ["Sydney"], [0])],
    });
    renderReveal();

    await waitFor(() => expect(screen.getByText("How your team did")).toBeInTheDocument());
    expect(screen.queryByText("DOUBLED ×2")).not.toBeInTheDocument();
  });
});
