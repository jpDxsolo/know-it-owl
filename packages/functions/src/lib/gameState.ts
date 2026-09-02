/**
 * Loading a game partition, and turning it into a viewer-specific snapshot.
 *
 * Every handler that returns a `Game` — the query, the join, and each mutation
 * that fans out a `GameUpdate` — goes through here, so there is exactly one
 * assembly path and therefore exactly one place where the visibility rules are
 * applied. Handlers that have just written may adjust the loaded state and
 * snapshot that, rather than re-reading eventually-consistent data.
 */
import type { Game, Player, Question, Round, Team, TeamResponse } from "@know-it-owl/core";
import { getItem, queryPrefix } from "./db.js";
import * as keys from "./keys.js";
import {
  isQuestionKey,
  isSubmissionKey,
  toGame,
  toPlayer,
  toQuestion,
  toRound,
  toSubmission,
  toTeam,
  toTeamResponse,
  type Submission,
} from "./mappers.js";
import { signRounds } from "./images.js";
import { visibleRounds, type ViewerRole } from "./visibility.js";
import { assembleGame, type GameView } from "./views.js";

export interface GameState {
  game: Game;
  /** Kept off `game` so it can never ride out in a response by accident. */
  gmTokenHash: string | undefined;
  players: Player[];
  teams: Team[];
  rounds: Round[];
  questions: Question[];
}

function byNumber<T extends { number: number }>(items: T[]): T[] {
  // A ROUND# query comes back in sort-key order, where ROUND#10 precedes ROUND#2.
  return [...items].sort((a, b) => a.number - b.number);
}

/** Read a whole game partition, or `undefined` when the game does not exist. */
export async function loadGameState(gameId: string): Promise<GameState | undefined> {
  const meta = await getItem(keys.gameMeta(gameId));
  if (!meta) return undefined;

  const pk = keys.gamePk(gameId);
  const [playerItems, teamItems, roundItems] = await Promise.all([
    queryPrefix(pk, keys.prefixes.players()),
    queryPrefix(pk, keys.prefixes.teams()),
    queryPrefix(pk, keys.prefixes.rounds()),
  ]);

  return {
    game: toGame(meta),
    gmTokenHash: typeof meta.gmTokenHash === "string" ? meta.gmTokenHash : undefined,
    players: playerItems.map(toPlayer),
    teams: teamItems.map(toTeam),
    // One ROUND# query returns rounds and their questions interleaved.
    rounds: byNumber(roundItems.filter((item) => !isQuestionKey(item.sk)).map(toRound)),
    questions: byNumber(roundItems.filter((item) => isQuestionKey(item.sk)).map(toQuestion)),
  };
}

/**
 * Assemble the `Game` this viewer is allowed to see.
 *
 * Answer keys and unreleased questions are in `state` for the length of the
 * call; `visibleRounds` is the only thing standing between them and the
 * response, which is why it lives in one module rather than per handler.
 *
 * Async because image keys become presigned GET URLs here — the bucket is
 * private, so a stored key is useless to a browser on its own.
 */
export async function snapshot(state: GameState, role: ViewerRole): Promise<GameView> {
  return assembleGame(
    state.game,
    state.players,
    state.teams,
    // Keys for the host, so a round can be saved to a file and opened again.
    await signRounds(visibleRounds(state.rounds, state.questions, role), role === "GM"),
  );
}

export interface RoundSubmissions {
  responses: TeamResponse[];
  /** One per team that has handed in — the marker items written with the answers. */
  submissions: Submission[];
}

/**
 * Read one round's answers and submission markers.
 *
 * Kept out of `GameState` on purpose: the game query and the fan-out snapshots
 * never need them, and a round's responses grow with the number of teams.
 */
export async function loadRoundSubmissions(
  gameId: string,
  roundNumber: number,
): Promise<RoundSubmissions> {
  const items = await queryPrefix(keys.gamePk(gameId), keys.prefixes.responses(roundNumber));
  return {
    responses: items.filter((item) => !isSubmissionKey(item.sk)).map(toTeamResponse),
    submissions: items.filter((item) => isSubmissionKey(item.sk)).map(toSubmission),
  };
}
