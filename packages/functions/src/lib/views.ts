/**
 * Response shapes the GraphQL schema asks for, as opposed to the stored shapes
 * in `mappers.ts`. `Game` in the schema carries its players and teams inline,
 * so handlers assemble these from several items in the game partition.
 */
import type { Game, Player, Team } from "@know-it-owl/core";

/** A team plus the roster of players assigned to it. */
export interface TeamView extends Team {
  players: Player[];
}

/** The `Game` type from the schema: the META item plus its players and teams. */
export interface GameView extends Game {
  players: Player[];
  teams: TeamView[];
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
export function assembleGame(game: Game, players: Player[], teams: Team[]): GameView {
  return {
    ...game,
    players,
    teams: teams.map((team) => ({
      ...team,
      players: players.filter((player) => player.teamId === team.id),
    })),
  };
}
