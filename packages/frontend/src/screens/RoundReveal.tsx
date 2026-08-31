/**
 * The reveal: what the answers were, what everyone wrote, and where that leaves
 * the table.
 *
 * This is the only screen the whole room looks at together, so it leads with the
 * one thing each team wants first — what *they* scored — and then gives the
 * argument-settling detail underneath.
 *
 * The round totals here are additions of what the host typed and nothing else.
 * A doubled team's points were doubled on entry, which is why there is no ×2
 * happening anywhere in this file: doing it here would double them twice.
 */
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useGame } from "../hooks/useGame";
import { useRoundResults, type RoundResult, type TeamResponse } from "../hooks/useRoundResults";
import { useStatusRedirect } from "../hooks/useStatusRedirect";
import { playerId } from "../services/identity";
import "./RoundReveal.css";

type Team = RoundResult["standings"][number];

/** Everything a team was given for one round. Addition, never multiplication. */
export function roundTotal(responses: readonly TeamResponse[], teamId: string): number {
  return responses
    .filter((response) => response.teamId === teamId && response.graded)
    .reduce(
      (total, response) =>
        total + (response.gradedPoints ?? []).reduce((sum, points) => sum + points, 0),
      0,
    );
}

/** Highest score first, keeping the server's order for ties. */
export function byScore(teams: readonly Team[]): Team[] {
  return [...teams].sort((left, right) => right.score - left.score);
}

export function RoundReveal() {
  const { gameId } = useParams<{ gameId: string }>();
  const { game, realtime, loading, error, viewer, lastEvent } = useGame(gameId);
  useStatusRedirect(gameId, game?.status, viewer, "reveal");

  const roundNumber = game?.currentRound ?? null;
  const { results, loading: reading, notYet, refresh } = useRoundResults(gameId, roundNumber);

  const me = playerId();
  const myTeam = game?.teams.find((team) => team.players.some((player) => player.id === me));

  // Arriving a moment before the host presses reveal is common; the refusal
  // turns into the results as soon as the broadcast says the round is out.
  useEffect(() => {
    if (lastEvent?.event === "ROUND_REVEALED") refresh();
  }, [lastEvent, refresh]);

  if (loading && !game) {
    return (
      <main className="kio-page">
        <AppHeader realtime={realtime} />
        <p className="kio-muted">Finding your game…</p>
      </main>
    );
  }

  if (notYet || (!results && reading)) {
    return (
      <main className="kio-page kio-reveal">
        <AppHeader realtime={realtime} />
        <h1>Not revealed yet</h1>
        <p className="kio-muted">
          Your host is still marking. The answers appear here the moment they finish — no need to
          refresh.
        </p>
      </main>
    );
  }

  if (!game || !results) {
    return (
      <main className="kio-page">
        <AppHeader realtime={realtime} />
        <p className="kio-field-error">
          {error ? error.message : "There is nothing to reveal yet."}
        </p>
      </main>
    );
  }

  const round = results.round;
  const teams = results.standings;
  const nameOf = (teamId: string): string =>
    teams.find((team) => team.id === teamId)?.name ?? "A team";

  const mine = myTeam
    ? {
        team: myTeam,
        total: roundTotal(results.responses, myTeam.id),
        doubled: results.responses.some(
          (response) => response.teamId === myTeam.id && response.doubled,
        ),
      }
    : undefined;

  return (
    <main className="kio-page kio-page--wide kio-reveal">
      <AppHeader realtime={realtime} />

      <header className="kio-reveal__head">
        <p className="kio-label">Round {round.number} revealed</p>
        <h1 className="kio-reveal__title">{round.category}</h1>
      </header>

      <div className="kio-reveal__layout">
        <section className="kio-reveal__answers">
          <h2 className="kio-reveal__sectionTitle">The answers</h2>
          <ol className="kio-reveal__questions">
            {round.questions.map((question) => (
              <li key={question.number} className="kio-card kio-revealq">
                <p className="kio-label">
                  Question {question.number} · {question.defaultPoints}{" "}
                  {question.defaultPoints === 1 ? "point" : "points"}
                </p>
                {question.type === "PICTURE_10" ? (
                  question.imageUrl ? (
                    <a
                      className="kio-picture-link"
                      href={question.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        className="kio-revealq__image"
                        src={question.imageUrl}
                        alt={`Picture round, question ${question.number}`}
                      />
                      <span className="kio-picture-link__hint">Open full size ↗</span>
                    </a>
                  ) : (
                    <p className="kio-muted">Picture round</p>
                  )
                ) : (
                  <p className="kio-revealq__prompt">{question.text}</p>
                )}

                <p className="kio-revealq__key">
                  <span className="kio-label">Correct answer</span>
                  {(question.correctAnswers ?? []).join(" · ") || "—"}
                </p>

                <ul className="kio-revealq__teams">
                  {teams.map((team) => {
                    const response = results.responses.find(
                      (entry) =>
                        entry.questionNumber === question.number && entry.teamId === team.id,
                    );
                    const points = (response?.gradedPoints ?? []).reduce(
                      (sum, value) => sum + value,
                      0,
                    );
                    return (
                      <li
                        key={team.id}
                        className={`kio-revealq__team${
                          team.id === myTeam?.id ? " kio-revealq__team--mine" : ""
                        }`}
                      >
                        <span className="kio-revealq__teamName">{nameOf(team.id)}</span>
                        <span className="kio-revealq__said">
                          {response ? response.answers.filter(Boolean).join(" · ") || "—" : "—"}
                        </span>
                        <span
                          className={`kio-revealq__points${
                            points > 0 ? " kio-revealq__points--scored" : ""
                          }`}
                        >
                          {points}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </section>

        <aside className="kio-reveal__side">
          {mine && (
            <section className="kio-card kio-reveal__mine">
              <h2 className="kio-label">How your team did</h2>
              <p className="kio-reveal__mineName">{mine.team.name}</p>
              <p className="kio-reveal__mineScore">{mine.total}</p>
              <p className="kio-muted">points this round</p>
              {mine.doubled && <p className="kio-reveal__doubled">DOUBLED ×2</p>}
            </section>
          )}

          <section className="kio-card">
            <h2 className="kio-label">Standings after round {round.number}</h2>
            <ol className="kio-reveal__standings">
              {byScore(teams).map((team, index) => (
                <li
                  key={team.id}
                  className={`kio-reveal__standing${
                    team.id === myTeam?.id ? " kio-reveal__standing--mine" : ""
                  }`}
                >
                  <span className="kio-reveal__place">{index + 1}</span>
                  <span className="kio-reveal__standingName">{team.name}</span>
                  <span className="kio-reveal__score">{team.score}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <p className="kio-muted kio-reveal__next">Your host will start the next round.</p>
    </main>
  );
}
