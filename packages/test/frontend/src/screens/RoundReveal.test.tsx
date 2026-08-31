import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@know-it-owl/frontend/hooks/useGame";
import { RoundReveal } from "@know-it-owl/frontend/screens/RoundReveal";
import { setApiConfig } from "@know-it-owl/frontend/services/config";

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
