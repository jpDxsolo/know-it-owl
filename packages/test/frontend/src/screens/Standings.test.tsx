import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@know-it-owl/frontend/hooks/useGame";
import { Standings } from "@know-it-owl/frontend/screens/Standings";
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

/** A socket the test can push a broadcast down. */
const sockets: InertSocket[] = [];
class DrivableSocket extends InertSocket {
  constructor() {
    super();
    sockets.push(this);
  }
}

const ME = "p1";

function player(id: string, displayName: string, teamId: string | null = null) {
  return { id, displayName, teamId };
}

function team(
  id: string,
  name: string,
  score: number,
  doubleUsedRound: number | null,
  members: ReturnType<typeof player>[],
) {
  return { id, name, score, doubleUsedRound, lastSubmittedRound: 2, players: members };
}

const ada = player(ME, "Ada", "t1");
const grace = player("p2", "Grace", "t2");
const alan = player("p3", "Alan", "t3");

function standing(scores: [number, number, number], status: Game["status"] = "FINISHED"): Game {
  return {
    id: "g1",
    joinCode: "ABC123",
    status,
    currentRound: 2,
    players: [ada, grace, alan],
    teams: [
      team("t1", "Owls", scores[0], 2, [ada]),
      team("t2", "Bears", scores[1], null, [grace]),
      team("t3", "Foxes", scores[2], 1, [alan]),
    ],
    rounds: [
      { number: 1, category: "One", status: "REVEALED", releasedCount: 1, questionCount: 1, questions: [] },
      { number: 2, category: "Two", status: "REVEALED", releasedCount: 1, questionCount: 1, questions: [] },
    ],
  };
}

function serve(snapshot: Game): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { game: snapshot } }),
    })),
  );
}

function renderStandings() {
  return render(
    <MemoryRouter initialEntries={["/game/g1/standings"]}>
      <Routes>
        <Route path="/game/:gameId/standings" element={<Standings />} />
      </Routes>
    </MemoryRouter>,
  );
}

function broadcast(snapshot: Game): void {
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
            event: "ROUND_REVEALED",
            player: null,
            game: snapshot,
          },
        },
      },
    }),
  } as MessageEvent<string>);
}

beforeEach(() => {
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

describe("the scoreboard", () => {
  it("ranks by score, highest first", async () => {
    serve(standing([24, 31, 12]));
    renderStandings();

    await waitFor(() => expect(screen.getByText("Final standings")).toBeInTheDocument());
    const names = screen.getAllByText(/Owls|Bears|Foxes/).map((node) => node.textContent);
    expect(names).toEqual(["Bears", "Owls", "Foxes"]);
    expect(screen.getByText("31")).toBeInTheDocument();
  });

  it("says which round each team spent its double on", async () => {
    serve(standing([24, 31, 12]));
    renderStandings();

    await waitFor(() => expect(screen.getByText("Doubled round 2")).toBeInTheDocument());
    expect(screen.getByText("Doubled round 1")).toBeInTheDocument();
    expect(screen.getByText("Double unused")).toBeInTheDocument();
  });

  it("marks the viewer's own team", async () => {
    serve(standing([24, 31, 12]));
    renderStandings();

    await waitFor(() => expect(screen.getByText("Your team")).toBeInTheDocument());
    expect(screen.getByText("Your team").closest("li")?.className).toContain(
      "kio-standings__row--mine",
    );
  });

  it("counts the rounds actually revealed", async () => {
    serve(standing([24, 31, 12]));
    renderStandings();

    await waitFor(() => expect(screen.getByText("After 2 rounds")).toBeInTheDocument());
  });

  it("is a running scoreboard mid-game and a result at the end", async () => {
    // REVEAL and ROUND_ACTIVE send a viewer elsewhere, so the mid-game
    // scoreboard is the one between rounds.
    serve(standing([24, 31, 12], "TEAMS_SET"));
    renderStandings();

    await waitFor(() => expect(screen.getByText("Standings")).toBeInTheDocument());
    expect(screen.getByText(/scores update as each round is revealed/i)).toBeInTheDocument();
    expect(screen.queryByText("Final standings")).not.toBeInTheDocument();
  });

  it("re-ranks live when a reveal changes the scores", async () => {
    serve(standing([24, 31, 12]));
    renderStandings();
    await waitFor(() => expect(screen.getByText("Final standings")).toBeInTheDocument());

    broadcast(standing([40, 31, 12]));

    await waitFor(() => {
      const names = screen.getAllByText(/Owls|Bears|Foxes/).map((node) => node.textContent);
      expect(names).toEqual(["Owls", "Bears", "Foxes"]);
    });
  });

  it("says there is nothing to show before the teams are drawn", async () => {
    const empty = standing([0, 0, 0]);
    empty.teams = [];
    serve(empty);
    renderStandings();

    await waitFor(() => expect(screen.getByText(/no scores yet/i)).toBeInTheDocument());
  });
});
