import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiConfig } from "@know-it-owl/frontend/services/config";
import {
  subscribeToGame,
  type GameUpdateEvent,
  type RealtimeStatus,
} from "@know-it-owl/frontend/services/realtime";

/**
 * A WebSocket we can drive: every instance registers itself so a test can ack
 * the handshake, push a frame, or drop the connection at will.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static get latest(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error("no socket was opened");
    return socket;
  }

  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | undefined;
  onmessage: ((event: MessageEvent<string>) => void) | undefined;
  onclose: (() => void) | undefined;
  onerror: (() => void) | undefined;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  /** Drive the handshake to the point where events flow. */
  goLive(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
    this.deliver({ type: "connection_ack", payload: { connectionTimeoutMs: 300_000 } });
    this.deliver({ type: "start_ack", id: this.subscriptionId });
  }

  get subscriptionId(): string {
    const start = this.sent.map((raw) => JSON.parse(raw) as { type: string; id?: string })
      .find((message) => message.type === "start");
    return start?.id ?? "";
  }

  /** What the `start` frame actually asked the server for. */
  get startPayload(): { query: string; variables: { gameId: string } } {
    const start = this.sent
      .map((raw) => JSON.parse(raw) as { type: string; payload?: { data?: string } })
      .find((message) => message.type === "start");
    return JSON.parse(start?.payload?.data ?? "{}") as {
      query: string;
      variables: { gameId: string };
    };
  }

  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  deliverUpdate(event: string): void {
    this.deliver({
      type: "data",
      id: this.subscriptionId,
      payload: { data: { onGameUpdated: { gameId: "g1", event } } },
    });
  }
}

/** Every subscription opened by a test, torn down in afterEach regardless. */
const running: Array<() => void> = [];

function watch(options: Parameters<typeof subscribeToGame>[0]): () => void {
  const stop = subscribeToGame(options);
  running.push(stop);
  return stop;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  // Full-jitter backoff; pin it to the top of the range so each delay is
  // exactly its ceiling and the assertions below can be off-by-one precise.
  vi.spyOn(Math, "random").mockReturnValue(1);
  setApiConfig({
    url: "https://api.example.test/graphql",
    realtimeUrl: "wss://realtime.example.test/graphql",
    apiKey: "da2-test",
  });
});

afterEach(() => {
  // A failed assertion skips the rest of its test, so a subscription stopped
  // only at the end of the body would leak its `online` listener into every
  // test after it — turning one failure into four.
  for (const stop of running.splice(0)) stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setApiConfig(undefined);
});

describe("the handshake", () => {
  it("dials the realtime host with the auth header, signed for the api host", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });

    const socket = FakeSocket.latest;
    expect(socket.protocols).toEqual(["graphql-ws"]);
    expect(socket.url.startsWith("wss://realtime.example.test/graphql?header=")).toBe(true);

    const header = new URL(socket.url).searchParams.get("header") ?? "";
    const auth = JSON.parse(atob(header)) as Record<string, string>;
    // Signing the realtime host instead is the classic way to get a silently
    // rejected handshake.
    expect(auth.host).toBe("api.example.test");
    expect(auth["x-api-key"]).toBe("da2-test");

    stop();
  });

  it("subscribes only after the connection is acked, and sends the query as a string", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });
    const socket = FakeSocket.latest;

    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0]) as { type: string }).toEqual({ type: "connection_init" });
    expect(socket.sent).toHaveLength(1);

    socket.deliver({ type: "connection_ack", payload: { connectionTimeoutMs: 300_000 } });
    const start = JSON.parse(socket.sent[1]) as {
      type: string;
      payload: { data: unknown; extensions: { authorization: Record<string, string> } };
    };
    expect(start.type).toBe("start");
    // A JSON string, not an object — AppSync rejects the object form.
    expect(typeof start.payload.data).toBe("string");
    expect(socket.startPayload.variables).toEqual({ gameId: "g1" });
    expect(socket.startPayload.query).toContain("subscription OnGameUpdated");
    expect(start.payload.extensions.authorization["x-api-key"]).toBe("da2-test");

    stop();
  });

  it("only reports live once the subscription itself is acked", () => {
    const statuses: RealtimeStatus[] = [];
    const stop = subscribeToGame({
      gameId: "g1",
      onEvent: () => {},
      onStatusChange: (status) => statuses.push(status),
    });
    const socket = FakeSocket.latest;

    socket.readyState = FakeSocket.OPEN;
    socket.onopen?.();
    socket.deliver({ type: "connection_ack", payload: {} });
    expect(statuses).toEqual(["connecting"]);

    socket.deliver({ type: "start_ack" });
    expect(statuses).toEqual(["connecting", "live"]);

    stop();
  });
});

describe("delivering events", () => {
  it("passes each update to the caller", () => {
    const seen: GameUpdateEvent[] = [];
    const stop = watch({ gameId: "g1", onEvent: (event) => seen.push(event) });
    FakeSocket.latest.goLive();

    FakeSocket.latest.deliverUpdate("PLAYER_JOINED");
    FakeSocket.latest.deliverUpdate("TEAMS_SET");

    expect(seen.map((event) => event.event)).toEqual(["PLAYER_JOINED", "TEAMS_SET"]);
    stop();
  });

  it("ignores a frame it cannot parse rather than tearing down", () => {
    const seen: GameUpdateEvent[] = [];
    const stop = watch({ gameId: "g1", onEvent: (event) => seen.push(event) });
    FakeSocket.latest.goLive();

    FakeSocket.latest.onmessage?.({ data: "not json" } as MessageEvent<string>);
    FakeSocket.latest.deliverUpdate("PLAYER_JOINED");

    expect(seen).toHaveLength(1);
    stop();
  });

  it("ignores a data frame with no update in it", () => {
    const seen: GameUpdateEvent[] = [];
    const stop = watch({ gameId: "g1", onEvent: (event) => seen.push(event) });
    FakeSocket.latest.goLive();

    FakeSocket.latest.deliver({ type: "data", payload: { data: { onGameUpdated: null } } });

    expect(seen).toEqual([]);
    stop();
  });
});

describe("recovering from a dropped connection", () => {
  it("reconnects with backoff and reports live again, so the caller knows to re-read", () => {
    const statuses: RealtimeStatus[] = [];
    const stop = subscribeToGame({
      gameId: "g1",
      onEvent: () => {},
      onStatusChange: (status) => statuses.push(status),
    });

    FakeSocket.latest.goLive();
    expect(statuses).toEqual(["connecting", "live"]);

    FakeSocket.latest.close();
    expect(statuses.at(-1)).toBe("offline");
    expect(FakeSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.latest.goLive();
    // A second `live` is the signal that a gap needs filling — it must be
    // emitted even though the status did not technically change value.
    expect(statuses).toEqual(["connecting", "live", "offline", "connecting", "live"]);

    stop();
  });

  it("backs off further on each successive failure", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });

    FakeSocket.latest.close();
    vi.advanceTimersByTime(499);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.latest.close();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);

    stop();
  });

  it("caps the delay rather than growing without bound", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });

    for (let attempt = 0; attempt < 12; attempt += 1) {
      FakeSocket.latest.close();
      vi.advanceTimersByTime(15_000);
    }

    expect(FakeSocket.instances.length).toBe(13);
    stop();
  });

  it("resets the backoff once a connection succeeds", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });

    FakeSocket.latest.close();
    vi.advanceTimersByTime(500);
    FakeSocket.latest.close();
    vi.advanceTimersByTime(1000);
    FakeSocket.latest.goLive();

    // A long-lived connection that later drops should retry promptly, not with
    // the delay it had reached an hour ago.
    FakeSocket.latest.close();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(4);

    stop();
  });

  it("treats a silent socket as dead once the keep-alive lapses", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });
    FakeSocket.latest.goLive();

    // The server acked with a 300s timeout and then said nothing at all.
    vi.advanceTimersByTime(300_000);
    expect(FakeSocket.latest.readyState).toBe(FakeSocket.CLOSED);

    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
    stop();
  });

  it("stays alive while keep-alives keep arriving", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });
    FakeSocket.latest.goLive();
    const socket = FakeSocket.latest;

    for (let minute = 0; minute < 10; minute += 1) {
      vi.advanceTimersByTime(60_000);
      socket.deliver({ type: "ka" });
    }

    expect(socket.readyState).toBe(FakeSocket.OPEN);
    expect(FakeSocket.instances).toHaveLength(1);
    stop();
  });

  it("closes and retries when the server reports an error", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });
    FakeSocket.latest.goLive();

    FakeSocket.latest.deliver({ type: "error", payload: { errors: [{ message: "nope" }] } });
    expect(FakeSocket.latest.readyState).toBe(FakeSocket.CLOSED);

    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
    stop();
  });

  it("reconnects immediately when the browser comes back online", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });
    FakeSocket.latest.goLive();

    // Several failures in, the backoff is long; the user should not wait it out
    // when their wifi is visibly back.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      FakeSocket.latest.close();
      vi.advanceTimersByTime(15_000);
    }
    const before = FakeSocket.instances.length;

    globalThis.dispatchEvent(new Event("online"));
    expect(FakeSocket.instances).toHaveLength(before + 1);

    stop();
  });
});

describe("unsubscribing", () => {
  it("stops retrying for good", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });
    FakeSocket.latest.goLive();

    stop();
    FakeSocket.latest.close();
    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("tells the server it is going, when the socket is still open", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });
    FakeSocket.latest.goLive();
    const socket = FakeSocket.latest;

    stop();

    const types = socket.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);
    expect(types).toContain("connection_terminate");
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
  });

  it("delivers nothing after being stopped", () => {
    const seen: GameUpdateEvent[] = [];
    const stop = watch({ gameId: "g1", onEvent: (event) => seen.push(event) });
    FakeSocket.latest.goLive();
    const socket = FakeSocket.latest;

    stop();
    socket.deliverUpdate("PLAYER_JOINED");

    expect(seen).toEqual([]);
  });

  it("ignores an online event after being stopped", () => {
    const stop = watch({ gameId: "g1", onEvent: () => {} });
    FakeSocket.latest.goLive();

    stop();
    globalThis.dispatchEvent(new Event("online"));

    expect(FakeSocket.instances).toHaveLength(1);
  });
});
