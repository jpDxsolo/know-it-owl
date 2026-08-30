/**
 * AppSync's realtime protocol, which is its own thing.
 *
 * It borrows the `graphql-ws` subprotocol name but not its message shapes: the
 * subscription travels as a *JSON-encoded string* inside `payload.data`, auth
 * is repeated per-subscription in `extensions.authorization`, and the auth
 * `host` must be the appsync-api host even though we are dialling the
 * appsync-realtime-api one. Standard graphql-ws clients cannot talk to it,
 * which is why this is hand-rolled rather than a dependency.
 *
 * The socket is expected to drop — phones sleep, wifi changes, AppSync recycles
 * connections. Everything here exists to make that a non-event: reconnect with
 * backoff, and tell the caller when we went away so it can re-read the state it
 * missed.
 */
import type { OnGameUpdatedSubscription } from "../gql/graphql";
import { OnGameUpdatedSubscription as OnGameUpdatedDocument } from "./api";
import { apiConfig } from "./config";

export type GameUpdateEvent = NonNullable<OnGameUpdatedSubscription["onGameUpdated"]>;

/**
 * `connecting` covers the first attempt and every retry. `live` means the
 * server has acked the subscription and events are flowing.
 */
export type RealtimeStatus = "connecting" | "live" | "offline";

export interface SubscribeOptions {
  gameId: string;
  onEvent: (event: GameUpdateEvent) => void;
  /**
   * Called on every status change. A `live` after a previous `live` means the
   * socket dropped and came back, and the caller has a gap to fill — this is
   * how `useGame` knows to re-read the game rather than trusting its cache.
   */
  onStatusChange?: (status: RealtimeStatus) => void;
}

const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 15_000;
/** AppSync sends `ka` about once a minute; miss two and the socket is dead. */
const KEEP_ALIVE_GRACE_MS = 150_000;

interface AckPayload {
  connectionTimeoutMs?: number;
}

interface ServerMessage {
  type: string;
  id?: string;
  payload?: AckPayload & { data?: OnGameUpdatedSubscription; errors?: unknown };
}

function encode(value: unknown): string {
  return btoa(JSON.stringify(value));
}

/** Full jitter: spreads a fleet's reconnections instead of synchronising them. */
function backoff(attempt: number): number {
  const ceiling = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt);
  return Math.random() * ceiling;
}

/**
 * Watch one game. Returns a function that tears the subscription down; calling
 * it stops all reconnection, so it is safe to call from an effect cleanup.
 */
export function subscribeToGame(options: SubscribeOptions): () => void {
  const { gameId, onEvent, onStatusChange } = options;
  const { realtimeUrl, apiKey, url } = apiConfig();
  // The signed host is the *api* host. Signing the realtime host is the usual
  // reason a handshake is rejected with no useful error.
  const auth = { host: new URL(url).host, "x-api-key": apiKey };

  let socket: WebSocket | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let keepAliveTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let closed = false;
  let status: RealtimeStatus | undefined;

  const setStatus = (next: RealtimeStatus): void => {
    // A repeated `live` is meaningful (a gap was closed); a repeated
    // `connecting` is just noise from the retry loop.
    if (status === next && next !== "live") return;
    status = next;
    onStatusChange?.(next);
  };

  const clearTimers = (): void => {
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    if (keepAliveTimer !== undefined) clearTimeout(keepAliveTimer);
    retryTimer = undefined;
    keepAliveTimer = undefined;
  };

  /**
   * Give up on a socket and queue a fresh one.
   *
   * Deliberately does not wait for `close()` to produce an `onclose`. A dropped
   * network leaves the socket in CLOSING indefinitely — the peer is gone, so
   * the closing handshake never completes — and a client that waits for that
   * event sits there believing it is live while receiving nothing. Detaching
   * the handlers first also means a late `onclose` cannot queue a second retry.
   */
  const dropAndRetry = (ws: WebSocket | undefined): void => {
    if (!ws || ws !== socket) return;
    socket = undefined;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      // Already closing or closed; the retry below is what matters.
    }
    scheduleRetry();
  };

  const armKeepAlive = (timeoutMs: number): void => {
    if (keepAliveTimer !== undefined) clearTimeout(keepAliveTimer);
    keepAliveTimer = setTimeout(() => {
      // Silence past the grace period means the socket is dead, whether or not
      // it will ever admit it.
      dropAndRetry(socket);
    }, timeoutMs);
  };

  function scheduleRetry(): void {
    if (closed || retryTimer !== undefined) return;
    setStatus("offline");
    const delay = backoff(attempt);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      connect();
    }, delay);
  }

  function connect(): void {
    if (closed) return;
    setStatus("connecting");

    const subscriptionId = crypto.randomUUID();
    const ws = new WebSocket(
      `${realtimeUrl}?header=${encode(auth)}&payload=${encode({})}`,
      ["graphql-ws"],
    );
    socket = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "connection_init" }));

    ws.onmessage = (frame: MessageEvent<string>) => {
      // A frame can arrive between `close()` and the socket actually closing,
      // and after teardown the caller is gone.
      if (closed || socket !== ws) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(frame.data) as ServerMessage;
      } catch {
        return; // Not something we can act on; the keep-alive timer still guards us.
      }

      switch (message.type) {
        case "connection_ack": {
          // AppSync offers 300s here, but it also sends `ka` every ~60s, so
          // waiting five minutes to notice a dead socket helps nobody. Take
          // whichever is sooner.
          armKeepAlive(
            Math.min(message.payload?.connectionTimeoutMs ?? KEEP_ALIVE_GRACE_MS, KEEP_ALIVE_GRACE_MS),
          );
          ws.send(
            JSON.stringify({
              id: subscriptionId,
              type: "start",
              payload: {
                // A string, not an object. This is the part everyone gets wrong.
                data: JSON.stringify({
                  query: OnGameUpdatedDocument.toString(),
                  variables: { gameId },
                }),
                extensions: { authorization: auth },
              },
            }),
          );
          break;
        }
        case "start_ack": {
          // Only now are we actually receiving events.
          attempt = 0;
          setStatus("live");
          break;
        }
        case "ka": {
          armKeepAlive(KEEP_ALIVE_GRACE_MS);
          break;
        }
        case "data": {
          const update = message.payload?.data?.onGameUpdated;
          if (update) onEvent(update);
          break;
        }
        case "error":
        case "connection_error": {
          // Includes a rejected handshake. Retrying is right for an expired
          // connection and harmless-but-futile for a bad key, which the
          // backoff keeps cheap.
          dropAndRetry(ws);
          break;
        }
        default:
          break;
      }
    };

    ws.onclose = () => dropAndRetry(ws);
    // A socket that errors may never close cleanly, so do not wait for it to.
    ws.onerror = () => dropAndRetry(ws);
  }

  // The browser knows about a reconnection before any timer does; jumping the
  // backoff queue turns a 15-second wait into an instant one.
  const onOnline = (): void => {
    if (closed) return;
    // Any socket that predates the network coming back is suspect, including
    // one we still believe is live: a half-open connection reports no error and
    // simply stops delivering. Cheaper to redial than to trust it.
    const stale = socket;
    socket = undefined;
    if (stale) {
      stale.onopen = null;
      stale.onmessage = null;
      stale.onclose = null;
      stale.onerror = null;
      try {
        stale.close();
      } catch {
        // Nothing to do; we are replacing it regardless.
      }
    }
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    attempt = 0;
    connect();
  };
  globalThis.addEventListener?.("online", onOnline);

  connect();

  return () => {
    closed = true;
    globalThis.removeEventListener?.("online", onOnline);
    clearTimers();
    const open = socket;
    socket = undefined;
    if (open && open.readyState === WebSocket.OPEN) {
      open.send(JSON.stringify({ type: "connection_terminate" }));
    }
    open?.close();
  };
}
