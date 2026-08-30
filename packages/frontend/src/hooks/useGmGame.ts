/**
 * The game as its host sees it.
 *
 * A thin layer over `useGame` rather than a second implementation: `useGame`
 * already knows how to hold a GM view — keeping the wider `rounds` that a
 * player-shaped broadcast would otherwise blank, and re-reading with the token
 * when an event could have changed them. Duplicating that merge here would give
 * two paths for the same data and, sooner or later, two different answers.
 *
 * What this adds is the host's own concerns: proof that this browser holds the
 * token, and who has handed in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { execute, RoundResultsQuery } from "../services/api";
import { gmToken as storedGmToken } from "../services/identity";
import { useGame, type UseGameResult } from "./useGame";

/** Statuses in which teams can be part-way through handing in. */
const TRACKS_SUBMISSIONS = new Set(["ROUND_ACTIVE", "GRADING"]);

export interface UseGmGameResult extends UseGameResult {
  /** The stored token, or null when this browser did not create the game. */
  gmToken: string | null;
  /** False means the dashboard should refuse rather than render. */
  isHost: boolean;
  /** Team ids that have handed in for the round in play. */
  submittedTeamIds: ReadonlySet<string>;
}

export function useGmGame(gameId: string | undefined): UseGmGameResult {
  const gmToken = useMemo(() => (gameId ? storedGmToken(gameId) : null), [gameId]);
  // Without the token the dashboard refuses to render, so there is nothing to
  // read and nothing to subscribe to — asking anyway would open a websocket for
  // a screen that is about to say no.
  const game = useGame(gmToken ? gameId : undefined);
  const [submittedTeamIds, setSubmittedTeamIds] = useState<ReadonlySet<string>>(new Set());

  const roundNumber = game.game?.currentRound ?? null;
  const status = game.game?.status;
  const tracking = status !== undefined && TRACKS_SUBMISSIONS.has(status) && roundNumber !== null;

  /** The round we currently care about, readable from inside a resolved promise. */
  const watchedRound = useRef<number | null>(null);
  watchedRound.current = roundNumber;

  const readSubmissions = useCallback(async (): Promise<void> => {
    if (!gameId || !gmToken || roundNumber === null) return;
    const forRound = roundNumber;
    try {
      const data = await execute(RoundResultsQuery, { gameId, roundNumber: forRound, gmToken });
      // A slow read for a finished round must not overwrite the one now in
      // play — the answer is stale by the time it lands, not merely late.
      if (watchedRound.current !== forRound) return;
      // A team appears here as soon as it has any response for the round, which
      // is exactly what "handed in" means — submitAnswers writes them together.
      setSubmittedTeamIds(
        new Set((data.roundResults?.responses ?? []).map((response) => response.teamId)),
      );
    } catch {
      // Losing the submission list is a cosmetic problem, not a reason to break
      // the dashboard; the next event or re-read will pick it up.
    }
  }, [gameId, gmToken, roundNumber]);

  /**
   * Counts hand-ins rather than events.
   *
   * ANSWERS_SUBMITTED is fanned out to us but carries no team id, so the list
   * has to be re-read. Every *other* event — someone joining, a double being
   * chosen — cannot change who has handed in, and re-reading on those would be
   * a request per arrival for an answer we already have.
   */
  const [handIns, setHandIns] = useState(0);
  const lastEvent = game.lastEvent;
  useEffect(() => {
    if (lastEvent?.event === "ANSWERS_SUBMITTED") setHandIns((count) => count + 1);
  }, [lastEvent]);

  useEffect(() => {
    if (!tracking) {
      setSubmittedTeamIds(new Set());
      return;
    }
    void readSubmissions();
  }, [tracking, readSubmissions, handIns]);

  return { ...game, gmToken, isHost: gmToken !== null, submittedTeamIds };
}
