/**
 * One game, kept current: an initial read, then live updates, then whatever it
 * takes to stay honest when the socket drops.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameFieldsFragment } from "../gql/graphql";
import { ApiError, execute, GameQuery } from "../services/api";
import { gmToken as storedGmToken } from "../services/identity";
import { subscribeToGame, type GameUpdateEvent, type RealtimeStatus } from "../services/realtime";

export type Game = GameFieldsFragment;
export type Viewer = "GM" | "PLAYER";

/**
 * Events after which the GM's view of the rounds is genuinely out of date.
 *
 * The rest — someone joining, teams drawn, a name changed, a double, a
 * submission — cannot change which rounds or questions exist, so there is
 * nothing to re-read.
 */
const ROUND_AFFECTING_EVENTS = new Set(["ROUND_STARTED", "QUESTION_RELEASED", "ROUND_REVEALED"]);

export interface MergeResult {
  game: Game;
  /** The caller should re-read with the GM token to reconcile `rounds`. */
  staleRounds: boolean;
}

/**
 * Fold a broadcast into what we already had.
 *
 * The awkward part: a `GameUpdate` is always a *player* snapshot, because it
 * goes to everyone. For a player that is simply the truth and replaces state
 * wholesale. For the GM it is a strictly narrower view than their query — no
 * DRAFT rounds, no unreleased questions, no answer keys — so taking it
 * wholesale would blank out the authoring view on every player's join.
 *
 * So the GM keeps the rounds they already had (which are a superset) and takes
 * everything else, since players, teams and status are the same for both
 * viewers. When the event is one that actually changes rounds, we say so and
 * the hook re-reads with the token.
 */
export function mergeGameSnapshot(
  current: Game | undefined,
  event: GameUpdateEvent,
  viewer: Viewer,
): MergeResult {
  const incoming = event.game;
  if (viewer === "PLAYER") {
    return { game: incoming, staleRounds: false };
  }
  if (!current) {
    // Nothing better to show yet; re-read immediately for the authoring view.
    return { game: incoming, staleRounds: true };
  }
  return {
    game: { ...incoming, rounds: current.rounds },
    staleRounds: ROUND_AFFECTING_EVENTS.has(event.event),
  };
}

export interface UseGameResult {
  game: Game | undefined;
  /** The most recent broadcast, for screens that animate on a specific event. */
  lastEvent: GameUpdateEvent | undefined;
  realtime: RealtimeStatus;
  loading: boolean;
  error: ApiError | undefined;
  viewer: Viewer;
  /** Force a re-read. The hook already does this when it needs to. */
  refresh: () => void;
}

export function useGame(gameId: string | undefined): UseGameResult {
  const [game, setGame] = useState<Game | undefined>();
  const [lastEvent, setLastEvent] = useState<GameUpdateEvent | undefined>();
  const [realtime, setRealtime] = useState<RealtimeStatus>("connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | undefined>();

  const gmToken = useMemo(() => (gameId ? storedGmToken(gameId) : null), [gameId]);
  const viewer: Viewer = gmToken ? "GM" : "PLAYER";

  /**
   * Bumped by every applied event. A read that started before an event landed
   * is older than what we already have, however late it resolves — so it is
   * discarded rather than allowed to overwrite live state with a stale
   * snapshot. This is the whole of the ordering story; there is no other clock.
   */
  const revision = useRef(0);
  const cancelled = useRef(false);
  /**
   * The merge needs the current game synchronously, and a state updater is not
   * allowed to have side effects (StrictMode calls it twice), so the snapshot
   * is mirrored here and `applyGame` is the only writer of both.
   */
  const latest = useRef<Game | undefined>(undefined);

  const applyGame = useCallback((next: Game) => {
    latest.current = next;
    setGame(next);
  }, []);

  const refresh = useCallback(() => {
    if (!gameId) return;
    const startedAt = revision.current;
    setLoading(true);
    execute(GameQuery, { gameId, gmToken })
      .then((data) => {
        if (cancelled.current) return;
        setError(undefined);
        if (revision.current !== startedAt) return; // An event overtook us.
        if (data.game) applyGame(data.game);
      })
      .catch((cause: unknown) => {
        if (cancelled.current) return;
        setError(
          cause instanceof ApiError ? cause : new ApiError(String(cause), "UNKNOWN"),
        );
      })
      .finally(() => {
        if (!cancelled.current) setLoading(false);
      });
  }, [gameId, gmToken, applyGame]);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    if (!gameId) {
      setLoading(false);
      return;
    }
    refresh();
  }, [gameId, refresh]);

  useEffect(() => {
    if (!gameId) return;

    // `live` after a previous `live` means the socket dropped and returned, so
    // there is a gap of events we never saw. Re-reading is the only way to
    // close it — which is what lets a disconnection recover without a reload.
    let hasBeenLive = false;

    const unsubscribe = subscribeToGame({
      gameId,
      onEvent: (event) => {
        revision.current += 1;
        setLastEvent(event);
        const merged = mergeGameSnapshot(latest.current, event, viewer);
        applyGame(merged.game);
        if (merged.staleRounds) refresh();
      },
      onStatusChange: (status) => {
        setRealtime(status);
        if (status !== "live") return;
        if (hasBeenLive) refresh();
        hasBeenLive = true;
      },
    });

    return unsubscribe;
  }, [gameId, viewer, refresh, applyGame]);

  return { game, lastEvent, realtime, loading, error, viewer, refresh };
}
