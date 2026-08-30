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
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const game = useGame(gameId);
  const [submittedTeamIds, setSubmittedTeamIds] = useState<ReadonlySet<string>>(new Set());

  const roundNumber = game.game?.currentRound ?? null;
  const status = game.game?.status;
  const tracking = status !== undefined && TRACKS_SUBMISSIONS.has(status) && roundNumber !== null;

  const readSubmissions = useCallback(async (): Promise<void> => {
    if (!gameId || !gmToken || roundNumber === null) return;
    try {
      const data = await execute(RoundResultsQuery, { gameId, roundNumber, gmToken });
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

  useEffect(() => {
    if (!tracking) {
      setSubmittedTeamIds(new Set());
      return;
    }
    void readSubmissions();
    // `lastEvent` is the cue: ANSWERS_SUBMITTED is fanned out to us, but it
    // carries no team id, so the list has to be re-read rather than patched.
  }, [tracking, readSubmissions, game.lastEvent]);

  return { ...game, gmToken, isHost: gmToken !== null, submittedTeamIds };
}
