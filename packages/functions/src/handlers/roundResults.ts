import type { TeamResponse } from "@know-it-owl/core";
import { optionalString, requiredInt, requiredString } from "../lib/args.js";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";
import { loadGameState, loadRoundSubmissions } from "../lib/gameState.js";
import { viewerRole, visibleRound, type VisibleRound } from "../lib/visibility.js";
import { assembleGame, type TeamView } from "../lib/views.js";
import { standingsFor } from "./standings.js";

export interface RoundResult {
  round: VisibleRound;
  responses: TeamResponse[];
  standings: TeamView[];
}

/**
 * `Query.roundResults(gameId, roundNumber, gmToken)`.
 *
 * Before the reveal this is the GM's grading view and nobody else's: it carries
 * every team's answers and the answer key. Once the round is REVEALED it is
 * public, because that is what revealing means.
 */
export async function roundResults(args: Record<string, unknown>): Promise<RoundResult | null> {
  const gameId = requiredString(args, "gameId");
  const roundNumber = requiredInt(args, "roundNumber", { min: 1 });
  const gmToken = optionalString(args, "gmToken");

  const state = await loadGameState(gameId);
  if (!state) return null;

  const role = viewerRole(gmToken, state.gmTokenHash);
  const round = state.rounds.find((candidate) => candidate.number === roundNumber);
  if (!round) throw new NotFoundError(`No round ${roundNumber} in this game`);

  if (round.status !== "REVEALED" && role !== "GM") {
    throw new ForbiddenError("These results are not public until the round is revealed");
  }

  const view = visibleRound(round, state.questions, role);
  if (!view) {
    // Unreachable: the gate above already let this viewer through.
    throw new ForbiddenError("These results are not public until the round is revealed");
  }

  const { responses } = await loadRoundSubmissions(gameId, roundNumber);
  const game = assembleGame(state.game, state.players, state.teams, []);

  return { round: view, responses, standings: standingsFor(game.teams) };
}
