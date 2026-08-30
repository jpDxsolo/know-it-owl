/**
 * One round's answers, as the viewer is allowed to see them.
 *
 * The same query serves two very different screens, which is the point: before
 * the reveal it is the host's marking sheet and nobody else's, and afterwards it
 * is the public result. The server decides which, so the only difference here is
 * whether a token is passed — and a player who arrives early gets a refusal,
 * which is a state to render rather than an error to report.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TypedDocumentString } from "../gql/graphql";
import { ApiError, execute, RoundResultsQuery } from "../services/api";

type QueryData =
  typeof RoundResultsQuery extends TypedDocumentString<infer Result, infer _Variables>
    ? Result
    : never;

export type RoundResult = NonNullable<QueryData["roundResults"]>;
export type TeamResponse = RoundResult["responses"][number];

export interface UseRoundResultsResult {
  results: RoundResult | undefined;
  loading: boolean;
  /** A refusal, not a failure: these results are not public yet. */
  notYet: boolean;
  error: ApiError | undefined;
  refresh: () => void;
}

export function useRoundResults(
  gameId: string | undefined,
  roundNumber: number | null | undefined,
  gmToken?: string | null,
): UseRoundResultsResult {
  const [results, setResults] = useState<RoundResult | undefined>();
  const [loading, setLoading] = useState(true);
  const [notYet, setNotYet] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();

  /**
   * The round we currently care about, readable from inside a resolved promise:
   * a slow read for a finished round must not overwrite the one now in play.
   */
  const watched = useRef<number | null | undefined>(roundNumber);
  watched.current = roundNumber;

  const refresh = useCallback(() => {
    if (!gameId || roundNumber === null || roundNumber === undefined) {
      setLoading(false);
      return;
    }
    const forRound = roundNumber;
    setLoading(true);
    execute(RoundResultsQuery, { gameId, roundNumber: forRound, gmToken: gmToken ?? null })
      .then((data) => {
        if (watched.current !== forRound) return;
        setError(undefined);
        setNotYet(false);
        setResults(data.roundResults ?? undefined);
      })
      .catch((cause: unknown) => {
        if (watched.current !== forRound) return;
        const failure =
          cause instanceof ApiError ? cause : new ApiError(String(cause), "UNKNOWN");
        // FORBIDDEN here means "not revealed yet", which every caller wants to
        // say in its own words rather than show as a server error.
        if (failure.code === "FORBIDDEN") {
          setNotYet(true);
          setResults(undefined);
          setError(undefined);
        } else {
          setError(failure);
        }
      })
      .finally(() => {
        if (watched.current === forRound) setLoading(false);
      });
  }, [gameId, roundNumber, gmToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { results, loading, notYet, error, refresh };
}
