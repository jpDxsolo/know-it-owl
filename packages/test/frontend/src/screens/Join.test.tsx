import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Join } from "@know-it-owl/frontend/screens/Join";
import { setApiConfig } from "@know-it-owl/frontend/services/config";
import { displayName, lastGame, playerId } from "@know-it-owl/frontend/services/identity";

/** Reply to the next fetch as AppSync would. */
function reply(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }),
  );
}

function joined(gameId = "game-1") {
  return { data: { joinGame: { gameId, event: "PLAYER_JOINED" } } };
}

function refused(errorType: string, message: string) {
  return { data: null, errors: [{ errorType, message }] };
}

function renderJoin() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Join />} />
        <Route path="/game/:gameId/lobby" element={<p>Lobby reached</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillIn(code: string, name: string): Promise<void> {
  await userEvent.type(screen.getByLabelText(/game code/i), code);
  await userEvent.type(screen.getByLabelText(/your name/i), name);
}

beforeEach(() => {
  localStorage.clear();
  setApiConfig({ url: "https://api.test/graphql", realtimeUrl: "wss://rt.test", apiKey: "da2-x" });
  reply(joined());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setApiConfig(undefined);
  localStorage.clear();
});

describe("joining", () => {
  it("cannot submit until there is both a code and a name", async () => {
    renderJoin();
    const button = screen.getByRole("button", { name: /join the quiz/i });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/game code/i), "ABC123");
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/your name/i), "Ada");
    expect(button).toBeEnabled();
  });

  it("uppercases the code as it is typed, since codes are always uppercase", async () => {
    renderJoin();
    await userEvent.type(screen.getByLabelText(/game code/i), "abc123");
    expect(screen.getByLabelText(/game code/i)).toHaveValue("ABC123");
  });

  it("sends the browser's stable player id, so a rejoin is the same seat", async () => {
    renderJoin();
    await fillIn("abc123", "Ada");
    await userEvent.click(screen.getByRole("button", { name: /join the quiz/i }));

    await waitFor(() => expect(screen.getByText("Lobby reached")).toBeInTheDocument());
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body)) as {
      variables: { joinCode: string; playerId: string; displayName: string };
    };
    expect(body.variables).toEqual({
      joinCode: "ABC123",
      playerId: playerId(),
      displayName: "Ada",
    });
  });

  it("remembers the name and the game for next time", async () => {
    renderJoin();
    await fillIn("abc123", "Ada");
    await userEvent.click(screen.getByRole("button", { name: /join the quiz/i }));

    await waitFor(() => expect(screen.getByText("Lobby reached")).toBeInTheDocument());
    expect(displayName()).toBe("Ada");
    expect(lastGame()).toEqual({ gameId: "game-1", joinCode: "ABC123", displayName: "Ada" });
  });

  it("trims a name padded with spaces", async () => {
    renderJoin();
    await fillIn("abc123", "  Ada  ");
    await userEvent.click(screen.getByRole("button", { name: /join the quiz/i }));

    await waitFor(() => expect(screen.getByText("Lobby reached")).toBeInTheDocument());
    expect(displayName()).toBe("Ada");
  });
});

describe("when the join is refused", () => {
  it("marks the code field only — the name was never the problem", async () => {
    // The whole point: a wrong code must not make a perfectly good name look
    // rejected too.
    reply(refused("NotFoundError", "No game with that join code"));
    renderJoin();
    await fillIn("zzz999", "Ada");
    await userEvent.click(screen.getByRole("button", { name: /join the quiz/i }));

    await waitFor(() =>
      expect(screen.getByText(/didn't match a game/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/game code/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/your name/i)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("marks the name field when the name is the thing that clashed", async () => {
    reply(refused("ConflictError", '"Ada" is already taken in this game'));
    renderJoin();
    await fillIn("abc123", "Ada");
    await userEvent.click(screen.getByRole("button", { name: /join the quiz/i }));

    await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/your name/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/game code/i)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("rewrites a lost connection into something a player can act on", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderJoin();
    await fillIn("abc123", "Ada");
    await userEvent.click(screen.getByRole("button", { name: /join the quiz/i }));

    await waitFor(() => expect(screen.getByText(/check your signal/i)).toBeInTheDocument());
  });

  it("stays on the screen so the player can correct and retry", async () => {
    reply(refused("NotFoundError", "No game with that join code"));
    renderJoin();
    await fillIn("zzz999", "Ada");
    await userEvent.click(screen.getByRole("button", { name: /join the quiz/i }));

    await waitFor(() => expect(screen.getByText(/didn't match a game/i)).toBeInTheDocument());
    expect(screen.queryByText("Lobby reached")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join the quiz/i })).toBeEnabled();
  });
});

describe("coming back", () => {
  it("prefills the code and offers to rejoin rather than asking again", async () => {
    // A player who locked their phone or went to the bar should not have to
    // find a code that was read out twenty minutes ago.
    reply(joined());
    renderJoin();
    await fillIn("abc123", "Ada");
    await userEvent.click(screen.getByRole("button", { name: /join the quiz/i }));
    await waitFor(() => expect(screen.getByText("Lobby reached")).toBeInTheDocument());
    cleanup();

    renderJoin();
    expect(screen.getByLabelText(/game code/i)).toHaveValue("ABC123");
    expect(screen.getByLabelText(/your name/i)).toHaveValue("Ada");
    expect(screen.getByRole("button", { name: /rejoin the quiz/i })).toBeEnabled();
    expect(screen.getByText(/welcome back, ada/i)).toBeInTheDocument();
  });

  it("asks fresh when this browser has never joined anything", () => {
    renderJoin();
    expect(screen.getByLabelText(/game code/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: /^join the quiz$/i })).toBeInTheDocument();
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
  });
});
