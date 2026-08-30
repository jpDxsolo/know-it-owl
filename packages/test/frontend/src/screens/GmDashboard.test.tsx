import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@know-it-owl/frontend/hooks/useGame";
import { GmDashboard } from "@know-it-owl/frontend/screens/GmDashboard";
import { setApiConfig } from "@know-it-owl/frontend/services/config";
import { setGmToken } from "@know-it-owl/frontend/services/identity";

class InertSocket {
  onopen: (() => void) | undefined;
  onmessage: (() => void) | undefined;
  onclose: (() => void) | undefined;
  onerror: (() => void) | undefined;
  readyState = 0;
  send(): void {}
  close(): void {}
}

let calls: { query: string; variables: Record<string, unknown> }[] = [];

function player(id: string, displayName: string, teamId: string | null = null) {
  return { id, displayName, teamId };
}

function team(id: string, name: string, members: ReturnType<typeof player>[]) {
  return { id, name, score: 0, doubleUsedRound: null, players: members };
}

function question(number: number, text = `Question ${number}`) {
  return {
    number,
    type: "TEXT" as const,
    text,
    imageUrl: null,
    defaultPoints: 1,
    correctAnswers: null,
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

/** Serve a game, plus optional roundResults for submission tracking. */
function serve(snapshot: Game, submittedTeamIds: string[] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      calls.push(body);
      if (body.query.includes("query RoundResults")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              roundResults: {
                round: null,
                responses: submittedTeamIds.map((teamId) => ({
                  roundNumber: 1,
                  questionNumber: 1,
                  teamId,
                  answers: ["x"],
                  doubled: false,
                  graded: false,
                  gradedPoints: null,
                })),
                standings: [],
              },
            },
          }),
        };
      }
      if (body.query.includes("query Game")) {
        return { ok: true, status: 200, json: async () => ({ data: { game: snapshot } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    }),
  );
}

function renderDashboard(state?: { justCreated: boolean }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/game/g1/gm", state }]}>
      <Routes>
        <Route path="/game/:gameId/gm" element={<GmDashboard />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
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

describe("who is allowed in", () => {
  it("refuses a browser with no host key, and explains why", async () => {
    // Deep-linking the dashboard without the token is not a bug to fix but a
    // fact to explain: the key never leaves the browser that made the game.
    serve(game());
    renderDashboard();

    expect(screen.getByText(/not your game to run/i)).toBeInTheDocument();
    expect(screen.getByText(/never leaves it/i)).toBeInTheDocument();
    expect(screen.queryByText("ABC123")).not.toBeInTheDocument();
  });

  it("does not even ask the server for a game it cannot run", async () => {
    // No token means no dashboard, so a query and a websocket would both be
    // work done for a screen that is about to refuse.
    serve(game());
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/not your game to run/i)).toBeInTheDocument());
    expect(calls.some((call) => call.query.includes("query Game"))).toBe(false);
  });

  it("lets the host in", async () => {
    setGmToken("g1", "token");
    serve(game());
    renderDashboard();
    await waitFor(() => expect(screen.getByText("ABC123")).toBeInTheDocument());
  });
});

describe("the one-time host notice", () => {
  it("appears only for a game just created in this tab", async () => {
    setGmToken("g1", "token");
    serve(game());
    renderDashboard({ justCreated: true });

    await waitFor(() => expect(screen.getByText(/this browser is now the host/i)).toBeInTheDocument());
    expect(screen.getByText(/send you another one/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.queryByText(/this browser is now the host/i)).not.toBeInTheDocument();
  });

  it("does not nag on an ordinary visit", async () => {
    setGmToken("g1", "token");
    serve(game());
    renderDashboard();
    await waitFor(() => expect(screen.getByText("ABC123")).toBeInTheDocument());
    expect(screen.queryByText(/this browser is now the host/i)).not.toBeInTheDocument();
  });
});

describe("before the teams are drawn", () => {
  it("shows the code and who has arrived", async () => {
    setGmToken("g1", "token");
    serve(game({ players: [player("p1", "Ada"), player("p2", "Grace")] }));
    renderDashboard();

    await waitFor(() => expect(screen.getByText("ABC123")).toBeInTheDocument());
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("2 players")).toBeInTheDocument();
  });

  it("cannot draw teams with fewer than two players", async () => {
    setGmToken("g1", "token");
    serve(game({ players: [player("p1", "Ada")] }));
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /draw the teams/i })).toBeDisabled(),
    );
    expect(screen.getByText(/waiting for at least 2 players/i)).toBeInTheDocument();
  });

  it("draws the teams with the chosen count", async () => {
    setGmToken("g1", "token");
    serve(game({ players: [player("p1", "Ada"), player("p2", "Grace")] }));
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /draw the teams/i }));
    await waitFor(() =>
      expect(calls.some((call) => call.query.includes("RandomizeTeams"))).toBe(true),
    );
    const draw = calls.find((call) => call.query.includes("RandomizeTeams"));
    expect(draw?.variables).toEqual({ gameId: "g1", gmToken: "token", teamCount: 2 });
  });

  it("will not start a round before the teams exist", async () => {
    setGmToken("g1", "token");
    serve(game({ players: [player("p1", "Ada"), player("p2", "Grace")] }));
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /start a round/i })).toBeDisabled();
    expect(screen.getByText(/draw the teams first/i)).toBeInTheDocument();
  });
});

describe("with teams but no rounds", () => {
  const seated = () =>
    game({
      status: "TEAMS_SET",
      players: [player("p1", "Ada", "t1"), player("p2", "Grace", "t2")],
      teams: [team("t1", "Owls", [player("p1", "Ada", "t1")]), team("t2", "Bears", [player("p2", "Grace", "t2")])],
    });

  it("says a round has to be written first", async () => {
    setGmToken("g1", "token");
    serve(seated());
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /start a round/i })).toBeDisabled();
    expect(screen.getByText(/write a round first/i)).toBeInTheDocument();
  });

  it("opens the round builder", async () => {
    setGmToken("g1", "token");
    serve(seated());
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /new round/i }));
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
  });

  it("offers to start once a round is written", async () => {
    setGmToken("g1", "token");
    serve({
      ...seated(),
      rounds: [
        {
          number: 1,
          category: "Capitals",
          status: "DRAFT",
          releasedCount: 0,
          questions: [question(1)],
        },
      ],
    });
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start round 1/i })).toBeEnabled(),
    );
    expect(screen.getByText(/round 1 · capitals/i)).toBeInTheDocument();
  });
});

describe("running a round", () => {
  const live = (releasedCount: number) =>
    game({
      status: "ROUND_ACTIVE",
      currentRound: 1,
      players: [player("p1", "Ada", "t1"), player("p2", "Grace", "t2")],
      teams: [team("t1", "Owls", [player("p1", "Ada", "t1")]), team("t2", "Bears", [player("p2", "Grace", "t2")])],
      rounds: [
        {
          number: 1,
          category: "Capitals",
          status: "ACTIVE",
          releasedCount,
          questions: [question(1), question(2), question(3)],
        },
      ],
    });

  it("offers exactly one next question — release is sequential", async () => {
    setGmToken("g1", "token");
    serve(live(1));
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/question 1 of 3 released/i)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /release next/i })).toHaveLength(1);
    expect(screen.getByText("Released")).toBeInTheDocument();
    expect(screen.getAllByText("Locked")).toHaveLength(1);
  });

  it("releases the next question by number", async () => {
    setGmToken("g1", "token");
    serve(live(1));
    renderDashboard();
    await waitFor(() => expect(screen.getByRole("button", { name: /release next/i })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: /release next/i }));
    await waitFor(() =>
      expect(calls.some((call) => call.query.includes("ReleaseQuestion"))).toBe(true),
    );
    expect(calls.find((call) => call.query.includes("ReleaseQuestion"))?.variables).toEqual({
      gameId: "g1",
      gmToken: "token",
      roundNumber: 1,
      questionNumber: 2,
    });
  });

  it("offers nothing to release once every question is out", async () => {
    setGmToken("g1", "token");
    serve(live(3));
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/question 3 of 3 released/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /release next/i })).not.toBeInTheDocument();
  });

  it("tracks who has handed in", async () => {
    setGmToken("g1", "token");
    serve(live(3), ["t1"]);
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/1 of 2 teams in/i)).toBeInTheDocument());
    expect(screen.getByText("Handed in")).toBeInTheDocument();
    expect(screen.getByText("Still writing")).toBeInTheDocument();
  });

  it("will not end the round while a team is still writing", async () => {
    // endRound refuses outright in this case, so offering it would only fail.
    setGmToken("g1", "token");
    serve(live(3), ["t1"]);
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/1 of 2 teams in/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /end round and reveal/i })).toBeDisabled();
    expect(screen.getByText(/every team has to hand in/i)).toBeInTheDocument();
  });

  it("ends the round once everyone is in", async () => {
    setGmToken("g1", "token");
    serve(live(3), ["t1", "t2"]);
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /end round and reveal/i })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: /end round and reveal/i }));
    await waitFor(() => expect(calls.some((call) => call.query.includes("EndRound"))).toBe(true));
    expect(calls.find((call) => call.query.includes("EndRound"))?.variables).toEqual({
      gameId: "g1",
      gmToken: "token",
      roundNumber: 1,
    });
  });

  it("labels a picture question rather than showing empty text", async () => {
    setGmToken("g1", "token");
    const picture = live(1);
    picture.rounds[0].questions[1] = {
      number: 2,
      type: "PICTURE_10",
      text: null,
      imageUrl: null,
      defaultPoints: 1,
      correctAnswers: null,
    };
    serve(picture);
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Picture round")).toBeInTheDocument());
  });
});

describe("when the game is gone", () => {
  it("says so instead of showing an empty dashboard", async () => {
    setGmToken("g1", "token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { game: null } }) }),
    );
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(/finished or been cleared away/i)).toBeInTheDocument(),
    );
  });
});
