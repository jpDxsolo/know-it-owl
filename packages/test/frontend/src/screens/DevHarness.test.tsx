/**
 * Regression tests for two things that made the harness unusable in a browser.
 * Both were consequences of correct behaviour elsewhere, which is what made
 * them confusing rather than obviously wrong.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevHarness } from "@know-it-owl/frontend/screens/DevHarness";
import { setApiConfig } from "@know-it-owl/frontend/services/config";
import { playerId, setGmToken } from "@know-it-owl/frontend/services/identity";

/** A socket that connects to nothing, so the harness can render in peace. */
class InertSocket {
  onopen: (() => void) | undefined;
  onmessage: (() => void) | undefined;
  onclose: (() => void) | undefined;
  onerror: (() => void) | undefined;
  readyState = 0;
  send(): void {}
  close(): void {}
}

const GAME = {
  id: "game-1",
  joinCode: "ABC123",
  status: "LOBBY",
  currentRound: null,
  players: [{ id: "someone-else", displayName: "Ada", teamId: null }],
  teams: [],
  rounds: [],
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dev" element={<DevHarness />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  setApiConfig({ url: "https://api.test/graphql", realtimeUrl: "wss://rt.test/graphql", apiKey: "da2-x" });
  vi.stubGlobal("WebSocket", InertSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { game: GAME } }) }),
  );
});

afterEach(() => {
  // Testing Library only auto-cleans when vitest runs with globals, which this
  // project does not — without this every render stacks up in the same document.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setApiConfig(undefined);
  localStorage.clear();
});

describe("being two players in two tabs", () => {
  it("starts as this browser's real identity", () => {
    renderAt("/dev");
    expect(screen.getByLabelText(/player id/i)).toHaveValue(playerId());
  });

  it("lets a tab take a throwaway identity, so a duplicated tab is a second player", async () => {
    // Duplicating a tab copies localStorage, so both tabs share one player id.
    // joinGame is idempotent on it — by design, so a refresh mid-game rejoins
    // the same seat — which means the second tab's join would otherwise just
    // rename the first player instead of adding one.
    renderAt("/dev");
    const field = screen.getByLabelText(/player id/i);
    const original = playerId();
    expect(field).toHaveValue(original);

    await userEvent.click(screen.getByRole("button", { name: /new identity/i }));

    expect(field).not.toHaveValue(original);
    expect((field as HTMLInputElement).value).toMatch(/^[0-9a-f-]{36}$/);
    // The browser's own identity is untouched; only this tab is pretending.
    expect(playerId()).toBe(original);
  });
});

describe("surviving a reload", () => {
  it("takes the watched game from the URL, not from component state", async () => {
    // The GM token was never lost on refresh — the harness simply forgot which
    // game it was in, which looked exactly like losing access.
    setGmToken("game-1", "gm-token");
    renderAt("/dev?game=game-1");

    expect(screen.getByLabelText("Game id")).toHaveValue("game-1");
    await waitFor(() => expect(screen.getByText(/ABC123/)).toBeInTheDocument());
    // Holding the token for this game is what makes the viewer the GM.
    expect(document.body.textContent).toContain("viewer: GM");
  });

  it("offers a way back into any game this browser is GM of", async () => {
    setGmToken("game-abcdef12", "gm-token");
    renderAt("/dev");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /game-abc/i })).toBeInTheDocument(),
    );
  });

  it("is a plain watcher with no game selected", () => {
    renderAt("/dev");
    expect(screen.getByLabelText("Game id")).toHaveValue("");
    expect(document.body.textContent).toContain("viewer: PLAYER");
  });
});
