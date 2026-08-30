import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGmToken,
  clearIdentity,
  displayName,
  gmGameIds,
  gmToken,
  gmTokenIsPersisted,
  isGm,
  playerId,
  setDisplayName,
  setGmToken,
} from "@know-it-owl/frontend/services/identity";

beforeEach(() => {
  localStorage.clear();
  clearIdentity();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("playerId", () => {
  it("mints one on first use and returns the same one after", () => {
    const first = playerId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(playerId()).toBe(first);
  });

  it("survives a reload, because that is what makes a rejoin idempotent", () => {
    const before = playerId();
    // A fresh page reads the same storage; the module's own cache is not it.
    expect(localStorage.getItem("kio.playerId")).toBe(before);
  });

  it("keeps one id for the page even when storage refuses to persist", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    const first = playerId();
    expect(first).toBeTruthy();
    // Without this, every joinGame in the session would be a different player.
    expect(playerId()).toBe(first);
  });

  it("still returns an id when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(playerId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("display name", () => {
  it("round-trips", () => {
    expect(displayName()).toBeNull();
    setDisplayName("Ada");
    expect(displayName()).toBe("Ada");
  });
});

describe("gm tokens", () => {
  it("are stored per game", () => {
    setGmToken("g1", "token-one");
    setGmToken("g2", "token-two");

    expect(gmToken("g1")).toBe("token-one");
    expect(gmToken("g2")).toBe("token-two");
    expect(gmToken("g3")).toBeNull();
  });

  it("decide whether this browser is the GM", () => {
    expect(isGm("g1")).toBe(false);
    setGmToken("g1", "token");
    expect(isGm("g1")).toBe(true);
    expect(isGm("g2")).toBe(false);
  });

  it("can be listed and cleared", () => {
    setGmToken("g1", "a");
    setGmToken("g2", "b");
    expect(gmGameIds().sort()).toEqual(["g1", "g2"]);

    clearGmToken("g1");
    expect(gmGameIds()).toEqual(["g2"]);
  });

  it("do not collide with the other identity keys", () => {
    setDisplayName("Ada");
    playerId();
    setGmToken("g1", "token");
    expect(gmGameIds()).toEqual(["g1"]);
  });

  it("report when storage silently dropped the token", () => {
    // The server issues a GM token once and cannot reissue it, so a write that
    // did not land means the game becomes unrunnable on refresh. Callers need
    // to be able to say so rather than find out later.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    setGmToken("g1", "token");
    expect(gmTokenIsPersisted("g1")).toBe(false);
  });

  it("report a persisted token normally", () => {
    setGmToken("g1", "token");
    expect(gmTokenIsPersisted("g1")).toBe(true);
  });
});

describe("clearIdentity", () => {
  it("drops the player, the name and every gm token", () => {
    playerId();
    setDisplayName("Ada");
    setGmToken("g1", "a");
    setGmToken("g2", "b");

    clearIdentity();

    expect(localStorage.getItem("kio.playerId")).toBeNull();
    expect(displayName()).toBeNull();
    expect(gmGameIds()).toEqual([]);
  });
});
