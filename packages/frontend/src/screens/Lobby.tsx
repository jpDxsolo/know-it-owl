/**
 * The room filling up, and then the teams.
 *
 * One screen with two faces. Before the draw it is a list of arrivals and a big
 * readable code; after it, the teams. They are the same screen because they are
 * the same moment to the people in the pub — nobody navigates between "waiting"
 * and "drawn", the host just does it and everyone's phone catches up.
 */
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useGame, type Game } from "../hooks/useGame";
import { useStatusRedirect } from "../hooks/useStatusRedirect";
import { ApiError, execute, RandomizeTeamsMutation, StartRoundMutation } from "../services/api";
import { gmToken, playerId } from "../services/identity";
import "./Lobby.css";

const MIN_TEAMS = 2;

type Team = Game["teams"][number];

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** The team this browser's player is on, if the teams have been drawn. */
function myTeam(game: Game, me: string): Team | undefined {
  return game.teams.find((team) => team.players.some((player) => player.id === me));
}

export function Lobby() {
  const { gameId } = useParams<{ gameId: string }>();
  const { game, realtime, loading, error, viewer } = useGame(gameId);
  useStatusRedirect(gameId, game?.status, viewer, "lobby");

  const me = playerId();
  const [teamCount, setTeamCount] = useState(MIN_TEAMS);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [copied, setCopied] = useState(false);

  const teamsDrawn = (game?.teams.length ?? 0) > 0;
  const mine = useMemo(() => (game ? myTeam(game, me) : undefined), [game, me]);
  // The host cannot start a round nobody has written yet, so the button has to
  // know whether one exists rather than promising something that will fail.
  const firstRound = game?.rounds.find((round) => round.number === 1);

  async function run(what: () => Promise<void>): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      await what();
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const drawTeams = () =>
    run(async () => {
      const token = gameId ? gmToken(gameId) : null;
      if (!gameId || !token) throw new Error("You are not the host of this game");
      await execute(RandomizeTeamsMutation, { gameId, gmToken: token, teamCount });
    });

  const startRound = () =>
    run(async () => {
      const token = gameId ? gmToken(gameId) : null;
      if (!gameId || !token) throw new Error("You are not the host of this game");
      await execute(StartRoundMutation, { gameId, gmToken: token, roundNumber: 1 });
    });

  async function copyCode(): Promise<void> {
    if (!game) return;
    try {
      await navigator.clipboard.writeText(game.joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission, or an insecure context. The code is on screen
      // in 32px type anyway, so this is a convenience and not a failure.
    }
  }

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

  const players = game.players;

  return (
    <main className="kio-page kio-page--wide kio-lobby">
      <AppHeader realtime={realtime} />

      {teamsDrawn ? (
        <p className="kio-lobby__codeQuiet kio-muted">Game code {game.joinCode}</p>
      ) : (
        <section className="kio-lobby__code">
          <h2 className="kio-label">Game code</h2>
          <div className="kio-lobby__codeRow">
            <p className="kio-lobby__codeValue">{game.joinCode}</p>
            <button className="kio-button kio-button--ghost" type="button" onClick={copyCode}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>
      )}

      <section>
        <div className="kio-lobby__sectionHead">
          <h1 className="kio-lobby__title">{teamsDrawn ? "Teams are set" : "In the lobby"}</h1>
          <p className="kio-muted">
            {teamsDrawn && `${game.teams.length} teams · `}
            {players.length} {players.length === 1 ? "player" : "players"}
          </p>
        </div>

        {teamsDrawn ? (
          <ul className="kio-lobby__teams">
            {game.teams.map((team) => (
              <li
                key={team.id}
                className={`kio-card kio-team${team.id === mine?.id ? " kio-team--mine" : ""}`}
              >
                <div className="kio-team__head">
                  <h2 className="kio-team__name">{team.name}</h2>
                  {team.id === mine?.id && <span className="kio-team__badge">Your team</span>}
                </div>
                <ul className="kio-team__players">
                  {team.players.map((player) => (
                    <li key={player.id} className="kio-chip">
                      <span className="kio-chip__avatar" aria-hidden="true">
                        {initial(player.displayName)}
                      </span>
                      {player.displayName}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : players.length === 0 ? (
          <p className="kio-muted">Nobody yet. Read the code out and they'll appear here.</p>
        ) : (
          <ul className="kio-lobby__players">
            {players.map((player) => (
              <li key={player.id} className="kio-card kio-player">
                <span className="kio-player__avatar" aria-hidden="true">
                  {initial(player.displayName)}
                </span>
                <span className="kio-player__name">{player.displayName}</span>
                {player.id === me && <span className="kio-player__badge">You</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {problem && <p className="kio-field-error">{problem}</p>}

      {viewer === "GM" ? (
        <section className="kio-lobby__host">
          <h2 className="kio-lobby__hostLabel">Host</h2>

          {!teamsDrawn && (
            <div className="kio-stepper">
              <span id="teamCount">Teams</span>
              <div className="kio-stepper__controls">
                <button
                  className="kio-stepper__button"
                  type="button"
                  onClick={() => setTeamCount((count) => Math.max(MIN_TEAMS, count - 1))}
                  disabled={teamCount <= MIN_TEAMS}
                  aria-label="One fewer team"
                >
                  −
                </button>
                <output className="kio-stepper__value" htmlFor="teamCount">
                  {teamCount}
                </output>
                <button
                  className="kio-stepper__button"
                  type="button"
                  onClick={() => setTeamCount((count) => Math.min(players.length, count + 1))}
                  disabled={teamCount >= players.length}
                  aria-label="One more team"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {teamsDrawn && (
            <button
              className="kio-button kio-button--secondary"
              type="button"
              onClick={drawTeams}
              disabled={busy}
            >
              Re-draw teams
            </button>
          )}

          <button
            className="kio-button kio-button--primary"
            type="button"
            onClick={teamsDrawn ? startRound : drawTeams}
            disabled={busy || (!teamsDrawn && players.length < MIN_TEAMS) || (teamsDrawn && !firstRound)}
          >
            {teamsDrawn ? "Start round 1" : "Draw the teams"}
          </button>

          {!teamsDrawn && players.length < MIN_TEAMS && (
            <p className="kio-muted">Waiting for at least {MIN_TEAMS} players.</p>
          )}
          {teamsDrawn && !firstRound && (
            <p className="kio-muted">Write round 1 before you can start it.</p>
          )}
        </section>
      ) : (
        <p className="kio-lobby__waiting kio-muted">
          {teamsDrawn
            ? "Sit tight — your host is about to start."
            : "Waiting for your host to draw the teams…"}
        </p>
      )}
    </main>
  );
}
