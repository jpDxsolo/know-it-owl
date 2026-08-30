import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@know-it-owl/frontend/hooks/useGame";
import { Lobby } from "@know-it-owl/frontend/screens/Lobby";
import { setApiConfig } from "@know-it-owl/frontend/services/config";
import { playerId, setGmToken } from "@know-it-owl/frontend/services/identity";

/** A socket that connects to nothing, so the screen can render in peace. */
class InertSocket {
  onopen: (() => void) | undefined;
  onmessage: (() => void) | undefined;
  onclose: (() => void) | undefined;
  onerror: (() => void) | undefined;
  readyState = 0;
  send(): void {}
  close(): void {}
}

function player(id: string, displayName: string, teamId: string | null = null) {
  return { id, displayName, teamId };
}

/** Typed against the real Game, so a schema change breaks these too. */
function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    joinCode: "ABC123",
    status: "LOBBY",
    currentRound: null,
    players: [],
    teams: [],
    rounds: [],
    ...overrides,
  };
}

function serve(snapshot: Game): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { game: snapshot } }),
    }),
  );
}

function renderLobby() {
  return render(
    <MemoryRouter initialEntries={["/game/game-1/lobby"]}>
      <Routes>
        <Route path="/game/:gameId/lobby" element={<Lobby />} />
        <Route path="/game/:gameId/round" element={<p>Player round screen</p>} />
        <Route path="/game/:gameId/gm" element={<p>Host dashboard</p>} />
        <Route path="/game/:gameId/reveal" element={<p>Reveal screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
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

describe("waiting for the room to fill", () => {
  it("shows the code large, because it is being read across a pub", async () => {
    serve(game());
    renderLobby();
    await waitFor(() => expect(screen.getByText("ABC123")).toBeInTheDocument());
  });

  it("says so plainly when nobody has arrived", async () => {
    serve(game());
    renderLobby();
    await waitFor(() => expect(screen.getByText(/nobody yet/i)).toBeInTheDocument());
  });

  it("lists arrivals and marks which one is you", async () => {
    const me = playerId();
    serve(game({ players: [player("other", "Grace"), player(me, "Ada")] }));
    renderLobby();

    await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("2 players")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("counts one player without pluralising", async () => {
    serve(game({ players: [player("p1", "Ada")] }));
    renderLobby();
    await waitFor(() => expect(screen.getByText("1 player")).toBeInTheDocument());
  });
});

describe("what the host can do", () => {
  it("offers nothing to a player, only a reassuring line", async () => {
    serve(game({ players: [player("p1", "Ada"), player("p2", "Grace")] }));
    renderLobby();

    await waitFor(() => expect(screen.getByText(/waiting for your host/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /draw the teams/i })).not.toBeInTheDocument();
  });

  it("shows the draw control to the host", async () => {
    setGmToken("game-1", "token");
    serve(game({ players: [player("p1", "Ada"), player("p2", "Grace")] }));
    renderLobby();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /draw the teams/i })).toBeEnabled(),
    );
    expect(screen.queryByText(/waiting for your host/i)).not.toBeInTheDocument();
  });

  it("cannot draw teams with only one player, and says why", async () => {
    setGmToken("game-1", "token");
    serve(game({ players: [player("p1", "Ada")] }));
    renderLobby();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /draw the teams/i })).toBeDisabled(),
    );
    expect(screen.getByText(/waiting for at least 2 players/i)).toBeInTheDocument();
  });

  it("will not let the stepper ask for more teams than there are players", async () => {
    setGmToken("game-1", "token");
    serve(game({ players: [player("p1", "Ada"), player("p2", "Grace")] }));
    renderLobby();

    await waitFor(() => expect(screen.getByText("Grace")).toBeInTheDocument());
    // Two players, two teams: already at the ceiling.
    expect(screen.getByRole("button", { name: /one more team/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /one fewer team/i })).toBeDisabled();
  });
});

describe("once the teams are drawn", () => {
  const drawn = () => {
    const me = playerId();
    return game({
      status: "TEAMS_SET",
      players: [player(me, "Ada", "t1"), player("p2", "Grace", "t2")],
      teams: [
        {
          id: "t1",
          name: "The Quizzly Bears",
          score: 0,
          doubleUsedRound: null,
          players: [player(me, "Ada", "t1")],
        },
        {
          id: "t2",
          name: "The Smarty Pants",
          score: 0,
          doubleUsedRound: null,
          players: [player("p2", "Grace", "t2")],
        },
      ],
    });
  };

  it("groups players into their teams and marks yours", async () => {
    serve(drawn());
    renderLobby();

    await waitFor(() => expect(screen.getByText("Teams are set")).toBeInTheDocument());
    expect(screen.getByText("The Quizzly Bears")).toBeInTheDocument();
    expect(screen.getByText("The Smarty Pants")).toBeInTheDocument();
    expect(screen.getByText("2 teams · 2 players")).toBeInTheDocument();
    // Only one card is yours, and it is the one you are actually on.
    expect(screen.getByText("Your team")).toBeInTheDocument();
  });

  it("demotes the code once it has done its job", async () => {
    serve(drawn());
    renderLobby();
    await waitFor(() => expect(screen.getByText(/game code abc123/i)).toBeInTheDocument());
  });

  it("will not offer to start a round nobody has written yet", async () => {
    // startRound would simply fail; better to say so than to offer it.
    setGmToken("game-1", "token");
    serve(drawn());
    renderLobby();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start round 1/i })).toBeDisabled(),
    );
    expect(screen.getByText(/write round 1 before you can start it/i)).toBeInTheDocument();
  });

  it("offers to start once round 1 exists", async () => {
    setGmToken("game-1", "token");
    serve({
      ...drawn(),
      rounds: [
        {
          number: 1,
          category: "Capitals",
          status: "DRAFT",
          releasedCount: 0,
          questionCount: 0,
          questions: [],
        },
      ],
    });
    renderLobby();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start round 1/i })).toBeEnabled(),
    );
  });

  it("lets the host re-draw", async () => {
    setGmToken("game-1", "token");
    serve(drawn());
    renderLobby();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /re-draw teams/i })).toBeEnabled(),
    );
  });
});

describe("moving on when the game does", () => {
  it("sends a player to the round screen", async () => {
    serve(game({ status: "ROUND_ACTIVE", currentRound: 1 }));
    renderLobby();
    await waitFor(() => expect(screen.getByText("Player round screen")).toBeInTheDocument());
  });

  it("sends the host to their dashboard instead — the player screen has no controls", async () => {
    setGmToken("game-1", "token");
    serve(game({ status: "ROUND_ACTIVE", currentRound: 1 }));
    renderLobby();
    await waitFor(() => expect(screen.getByText("Host dashboard")).toBeInTheDocument());
  });

  it("sends everyone to the reveal", async () => {
    serve(game({ status: "REVEAL", currentRound: 1 }));
    renderLobby();
    await waitFor(() => expect(screen.getByText("Reveal screen")).toBeInTheDocument());
  });

  it("stays put while the game is still in the lobby", async () => {
    serve(
      game({
        status: "TEAMS_SET",
        players: [player("p1", "Ada", "t1")],
        teams: [
          {
            id: "t1",
            name: "The Quizzly Bears",
            score: 0,
            doubleUsedRound: null,
            players: [player("p1", "Ada", "t1")],
          },
        ],
      }),
    );
    renderLobby();
    await waitFor(() => expect(screen.getByText("Teams are set")).toBeInTheDocument());
    expect(screen.queryByText("Player round screen")).not.toBeInTheDocument();
    expect(screen.queryByText("Host dashboard")).not.toBeInTheDocument();
  });
});

describe("when there is no game to show", () => {
  it("explains rather than showing an empty lobby", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { game: null } }) }),
    );
    renderLobby();
    await waitFor(() =>
      expect(screen.getByText(/finished or been cleared away/i)).toBeInTheDocument(),
    );
  });
});
