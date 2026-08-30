/**
 * Response shapes the GraphQL schema asks for, as opposed to the stored shapes
 * in `mappers.ts`. `Game` in the schema carries its players and teams inline,
 * so handlers assemble these from several items in the game partition.
 */
import type { Game, Player, Team } from "@know-it-owl/core";
import type { VisibleRound } from "./visibility.js";

/** A team plus the roster of players assigned to it. */
export interface TeamView extends Team {
  players: Player[];
}

/**
 * The `Game` type from the schema: the META item plus its players, teams and
 * the rounds this viewer is allowed to see. `rounds` is already filtered by
 * `visibility.ts` — nothing downstream re-checks it.
 */
export interface GameView extends Game {
  players: Player[];
  teams: TeamView[];
  rounds: VisibleRound[];
}

export interface CreateGamePayload {
  game: GameView;
  /** Returned exactly once, at creation. Only its hash is ever stored. */
  gmToken: string;
}

export interface JoinGamePayload {
  game: GameView;
  player: Player;
}

/** Group players onto their teams, preserving the order each list arrives in. */
export function assembleGame(
  game: Game,
  players: Player[],
  teams: Team[],
  rounds: VisibleRound[],
): GameView {
  return {
    ...game,
    players,
    rounds,
    teams: teams.map((team) => ({
      ...team,
      players: players.filter((player) => player.teamId === team.id),
    })),
  };
}
