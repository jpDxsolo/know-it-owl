/**
 * The KIO-10 acceptance criteria, run against a real deployed stage.
 *
 * Skipped unless API_URL and API_KEY are set, so the default suite stays
 * hermetic:
 *
 *   API_URL=... API_KEY=... npx vitest run frontend/src/hooks/useGame.live
 *
 * Both values are printed by `npx sst deploy`; see
 * docs/dev-smoke-test.md.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { CreateGameMutation, execute, JoinGameMutation } from "@know-it-owl/frontend/services/api";
import { setApiConfig } from "@know-it-owl/frontend/services/config";
import { useGame } from "@know-it-owl/frontend/hooks/useGame";

const apiUrl = process.env.API_URL;
const apiKey = process.env.API_KEY;

/** Every socket the client opened, so a test can drop one on purpose. */
const sockets: WebSocket[] = [];

beforeAll(() => {
  if (!apiUrl || !apiKey) return;
  setApiConfig({
    url: apiUrl,
    realtimeUrl: apiUrl.replace("appsync-api", "appsync-realtime-api").replace(/^http/, "ws"),
    apiKey,
  });

  const Real = globalThis.WebSocket;
  class RecordingSocket extends Real {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      sockets.push(this);
    }
  }
  globalThis.WebSocket = RecordingSocket as unknown as typeof WebSocket;
});

afterAll(() => setApiConfig(undefined));

describe.skipIf(!apiUrl || !apiKey)("useGame against the dev stage", () => {
  it(
    "observes a join made from another client",
    async () => {
      // A GM tab creates the game.
      const created = await execute(CreateGameMutation);
      const gameId = created.createGame.game.id;
      const joinCode = created.createGame.game.joinCode;
      expect(created.createGame.game.status).toBe("LOBBY");

      // A player tab renders the hook and subscribes.
      const { result, unmount } = renderHook(() => useGame(gameId));
      onTestFinished(unmount);

      await waitFor(() => expect(result.current.game?.id).toBe(gameId), { timeout: 15_000 });
      await waitFor(() => expect(result.current.realtime).toBe("live"), { timeout: 15_000 });
      expect(result.current.game?.players).toHaveLength(0);

      // "Another tab" joins. Nothing tells the hook — only the fan-out can.
      await execute(JoinGameMutation, {
        joinCode,
        playerId: "kio10-player-1",
        displayName: "Integration Ada",
      });

      await waitFor(
        () => expect(result.current.game?.players.map((p) => p.displayName)).toEqual(["Integration Ada"]),
        { timeout: 15_000 },
      );
      expect(result.current.lastEvent?.event).toBe("PLAYER_JOINED");
      expect(result.current.lastEvent?.player?.displayName).toBe("Integration Ada");
      expect(result.current.viewer).toBe("PLAYER");
    },
    60_000,
  );

  it(
    "recovers state missed while the network was down, with no reload",
    async () => {
      const created = await execute(CreateGameMutation);
      const gameId = created.createGame.game.id;
      const joinCode = created.createGame.game.joinCode;

      const from = sockets.length;
      const { result, unmount } = renderHook(() => useGame(gameId));
      onTestFinished(unmount);
      await waitFor(() => expect(result.current.realtime).toBe("live"), { timeout: 15_000 });

      // Take the network away and hold it away: every reconnect attempt fails
      // while it is down, so the join below cannot possibly arrive as an event.
      const connected = globalThis.WebSocket;
      class DeadSocket extends EventTarget {
        readyState = 3;
        onclose: (() => void) | undefined;
        constructor() {
          super();
          setTimeout(() => this.onclose?.(), 0);
        }
        send(): void {}
        close(): void {}
      }
      globalThis.WebSocket = DeadSocket as unknown as typeof WebSocket;
      // Closing a socket whose peer has gone leaves it in CLOSING for good, so
      // this deliberately does *not* wait for the client to notice: it cannot,
      // until the keep-alive lapses. That is exactly the half-open case, and
      // the point is that recovery does not depend on noticing.
      for (const socket of sockets.slice(from)) socket.close();

      // A change the client is guaranteed to have missed.
      await execute(JoinGameMutation, {
        joinCode,
        playerId: "kio10-player-2",
        displayName: "Reconnect Grace",
      });
      expect(result.current.game?.players).toHaveLength(0);

      // The network comes back, which is the signal a browser actually gives.
      // Nothing reloads the page and nothing replays the lost event — the
      // client has to redial and re-read for itself.
      globalThis.WebSocket = connected;
      globalThis.dispatchEvent(new Event("online"));

      await waitFor(() => expect(result.current.realtime).toBe("live"), { timeout: 20_000 });
      await waitFor(
        () => expect(result.current.game?.players.map((p) => p.displayName)).toEqual(["Reconnect Grace"]),
        { timeout: 20_000 },
      );
    },
    90_000,
  );
});
