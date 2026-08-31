/**
 * The scoreboard, and at the end of the night the result.
 *
 * A scoreboard is a list, not a grid, so this is the one wide-ish screen that
 * stays a single column at every size and grows its type instead. What desktop
 * buys here is legibility across a table, not columns.
 *
 * Each row says which round a team spent its double on. That is the one piece
 * of a team's play that the score alone hides, and it is what people argue
 * about afterwards.
 */
import { useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useGame, type Game } from "../hooks/useGame";
import { useStatusRedirect } from "../hooks/useStatusRedirect";
import { playerId } from "../services/identity";
import "./Standings.css";

type Team = Game["teams"][number];

/** Highest score first, keeping the server's order for ties. */
export function byScore(teams: readonly Team[]): Team[] {
  return [...teams].sort((left, right) => right.score - left.score);
}

export function Standings() {
  const { gameId } = useParams<{ gameId: string }>();
  const { game, realtime, loading, error, viewer } = useGame(gameId);
  useStatusRedirect(gameId, game?.status, viewer, "standings");

  const me = playerId();

  if (loading && !game) {
    return (
      <main className="kio-page">
        <AppHeader realtime={realtime} />
        <p className="kio-muted">Finding your game…</p>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="kio-page">
        <AppHeader realtime={realtime} />
        <p className="kio-field-error">
          {error ? error.message : "That game has finished or been cleared away."}
        </p>
      </main>
    );
  }

  const ranked = byScore(game.teams);
  const [leader, ...rest] = ranked;
  const finished = game.status === "FINISHED";
  const roundsPlayed = game.rounds.filter((round) => round.status === "REVEALED").length;
  const mine = game.teams.find((team) => team.players.some((player) => player.id === me));

  const doubleNote = (team: Team): string =>
    team.doubleUsedRound === null ? "Double unused" : `Doubled round ${team.doubleUsedRound}`;

  if (ranked.length === 0) {
    return (
      <main className="kio-page kio-standings">
        <AppHeader realtime={realtime} />
        <h1>No scores yet</h1>
        <p className="kio-muted">The teams have not been drawn.</p>
      </main>
    );
  }

  return (
    <main className="kio-page kio-standings">
      <AppHeader realtime={realtime} />

      <header className="kio-standings__head">
        <p className="kio-label">
          {roundsPlayed === 0
            ? "Before the first round"
            : `After ${roundsPlayed} ${roundsPlayed === 1 ? "round" : "rounds"}`}
        </p>
        <h1 className="kio-standings__title">{finished ? "Final standings" : "Standings"}</h1>
      </header>

      <section className={`kio-card kio-leader${leader.id === mine?.id ? " kio-leader--mine" : ""}`}>
        <span className="kio-leader__place" aria-hidden="true">
          1
        </span>
        <div className="kio-leader__who">
          <h2 className="kio-leader__name">{leader.name}</h2>
          <p className="kio-muted">{doubleNote(leader)}</p>
          {leader.id === mine?.id && <p className="kio-standings__yours">Your team</p>}
        </div>
        <p className="kio-leader__score">
          {leader.score}
          <span className="kio-sr-only"> points, first place</span>
        </p>
      </section>

      <ol className="kio-standings__rest" start={2}>
        {rest.map((team, index) => (
          <li
            key={team.id}
            className={`kio-card kio-standings__row${
              team.id === mine?.id ? " kio-standings__row--mine" : ""
            }`}
          >
            <span className="kio-standings__place">{index + 2}</span>
            <div className="kio-standings__who">
              <p className="kio-standings__name">{team.name}</p>
              <p className="kio-muted">{doubleNote(team)}</p>
              {team.id === mine?.id && <p className="kio-standings__yours">Your team</p>}
            </div>
            <p className="kio-standings__score">{team.score}</p>
          </li>
        ))}
      </ol>

      <p className="kio-muted kio-standings__foot">
        {finished
          ? "That's the lot. Thanks for playing."
          : "Scores update as each round is revealed."}
      </p>
    </main>
  );
}
