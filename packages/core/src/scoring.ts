/**
 * Scoring is deliberately addition and nothing else.
 *
 * The GM enters the points a team earned for each question, and those numbers
 * are final: the server never multiplies a doubled team's points, never scales
 * a multi-part question, and never infers a score from the answer key. A double
 * is applied by the GM when entering points, which keeps every scoring judgment
 * — partial credit, a generous ruling, a contested answer — in the one place a
 * human can explain it.
 */
import type { TeamResponse } from "./types.js";

/** Total a team earned across the responses given, ignoring ungraded ones. */
export function sumRoundPoints(responses: readonly TeamResponse[]): number {
  return responses.reduce((total, response) => {
    if (!response.graded || response.gradedPoints === null) return total;
    return total + response.gradedPoints.reduce((sum, points) => sum + points, 0);
  }, 0);
}

/**
 * Round totals per team. Teams that submitted nothing simply do not appear —
 * callers treat an absent team as zero rather than being blocked by it.
 */
export function sumRoundPointsByTeam(
  responses: readonly TeamResponse[],
): Map<string, number> {
  const byTeam = new Map<string, TeamResponse[]>();
  for (const response of responses) {
    const existing = byTeam.get(response.teamId);
    if (existing) existing.push(response);
    else byTeam.set(response.teamId, [response]);
  }

  const totals = new Map<string, number>();
  for (const [teamId, teamResponses] of byTeam) {
    totals.set(teamId, sumRoundPoints(teamResponses));
  }
  return totals;
}
