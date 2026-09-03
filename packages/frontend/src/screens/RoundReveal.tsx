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
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useGame } from "../hooks/useGame";
import { useRoundResults, type RoundResult, type TeamResponse } from "../hooks/useRoundResults";
import { useStatusRedirect } from "../hooks/useStatusRedirect";
import { ApiError, execute, FinishGameMutation, StartRoundMutation } from "../services/api";
import { gmToken as storedGmToken, playerId } from "../services/identity";
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
  const navigate = useNavigate();
  const { game, realtime, loading, error, viewer, lastEvent } = useGame(gameId);
  useStatusRedirect(gameId, game?.status, viewer, "reveal");

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string>();

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

  // The GM's own view carries DRAFT rounds; a player's never does.
  const draft = game.rounds.find((candidate) => candidate.status === "DRAFT");

  /*
   * A level top of the table, which is the only reason a tie-breaker exists.
   * Read from the standings the reveal already carries, so it reflects the
   * round just scored rather than the one before it.
   */
  const ordered = byScore(teams);
  const top = ordered[0];
  const tiedAtTop = ordered.filter((team) => top && team.score === top.score);
  const tied = tiedAtTop.length > 1;

  async function finish(): Promise<void> {
    const token = gameId ? storedGmToken(gameId) : null;
    if (!gameId || !token) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await execute(FinishGameMutation, { gameId, gmToken: token });
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function startNext(roundNumber: number): Promise<void> {
    const token = gameId ? storedGmToken(gameId) : null;
    if (!gameId || !token) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await execute(StartRoundMutation, { gameId, gmToken: token, roundNumber });
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

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

                {question.type === "PICTURE_10" ? (
                  /*
                   * Ten answers to ten numbered things in one picture. Run
                   * together on a line they are unreadable — nobody can tell
                   * which belongs to which — so each keeps the number it was
                   * asked under, in the same shape the team typed it into.
                   */
                  <div>
                    <span className="kio-label">Correct answers</span>
                    <ol className="kio-slots">
                      {(question.correctAnswers ?? []).map((answer, index) => (
                        <li key={index} className="kio-slots__row">
                          <span className="kio-slots__number">{index + 1}</span>
                          <span className="kio-slots__value kio-slots__value--key">{answer}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className="kio-revealq__key">
                    <span className="kio-label">Correct answer</span>
                    {(question.correctAnswers ?? []).join(" · ") || "—"}
                  </p>
                )}

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
                          question.type === "PICTURE_10" ? " kio-revealq__team--picture" : ""
                        }${team.id === myTeam?.id ? " kio-revealq__team--mine" : ""}`}
                      >
                        <span className="kio-revealq__teamName">{nameOf(team.id)}</span>
                        {question.type === "PICTURE_10" ? (
                          /* Numbered the same way, so a team can read straight
                             down against the key and see which ones they got. */
                          <ol className="kio-slots">
                            {(question.correctAnswers ?? []).map((_, index) => {
                              const said = response?.answers[index]?.trim();
                              const scored = (response?.gradedPoints?.[index] ?? 0) > 0;
                              return (
                                <li key={index} className="kio-slots__row">
                                  <span className="kio-slots__number">{index + 1}</span>
                                  <span
                                    className={`kio-slots__value${
                                      scored ? " kio-slots__value--scored" : ""
                                    }`}
                                  >
                                    {said || "—"}
                                  </span>
                                </li>
                              );
                            })}
                          </ol>
                        ) : (
                          <span className="kio-revealq__said">
                            {response ? response.answers.filter(Boolean).join(" · ") || "—" : "—"}
                          </span>
                        )}
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

      {viewer === "GM" ? (
        /*
         * The host's way out of here.
         *
         * A reveal is a pause, not an ending — the server is happy to start
         * another round from REVEAL, and happy to have one written. But this
         * screen offered nothing, and it is where the host lands the moment
         * they reveal, so the quiz looked finished after one round.
         */
        <div className="kio-reveal__host">
          {problem && <p className="kio-field-error">{problem}</p>}
          {draft ? (
            <button
              className="kio-button kio-button--primary"
              type="button"
              onClick={() => void startNext(draft.number)}
              disabled={busy}
            >
              {busy ? "Starting…" : `Start round ${draft.number}`}
            </button>
          ) : tied ? (
            /*
             * With the table level, the tie-breaker is the thing the host
             * actually wants — so it leads, rather than hiding behind a warning
             * in the finish dialog. It is an ordinary one-question round: asked,
             * answered, marked and revealed like any other.
             */
            <button
              className="kio-button kio-button--primary"
              type="button"
              onClick={() => navigate(`/game/${gameId}/gm`, { state: { tieBreaker: true } })}
            >
              Write a tie-breaker
            </button>
          ) : (
            <button
              className="kio-button kio-button--primary"
              type="button"
              onClick={() => navigate(`/game/${gameId}/gm`)}
            >
              Write the next round
            </button>
          )}
          {/*
            * Secondary, and deliberately so: ending the quiz is the rarer of
            * the two and cannot be undone, so it never sits where a host is
            * already aiming to press "start".
            */}
          <button
            className="kio-button kio-button--secondary"
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            Finish the game
          </button>
          <p className="kio-muted">
            {draft
              ? "Everyone moves on with you."
              : tied
                ? `${tiedAtTop.map((team) => team.name).join(" and ")} are level on ${top.score}.`
                : "Nothing written yet — the dashboard is where rounds are made."}
          </p>
        </div>
      ) : (
        <p className="kio-muted kio-reveal__next">Your host will start the next round.</p>
      )}
      {confirming && (
        <div className="kio-confirm" role="dialog" aria-modal="true" aria-labelledby="finishTitle">
          <div className="kio-card kio-confirm__box">
            <h2 className="kio-confirm__title" id="finishTitle">
              Finish the game?
            </h2>
            {tied && (
              <p className="kio-muted">
                {tiedAtTop.map((team) => team.name).join(" and ")} are level on {top.score}.
                Finishing now leaves them joint winners.
              </p>
            )}
            <p className="kio-muted">
              The scores stop here and everyone goes to the final standings. There is no way back
              — a finished game cannot be restarted.
            </p>
            <div className="kio-confirm__actions">
              <button
                className="kio-button kio-button--secondary"
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Keep playing
              </button>
              <button
                className="kio-button kio-button--primary"
                type="button"
                onClick={() => void finish()}
                disabled={busy}
              >
                {busy ? "Finishing…" : "Finish the game"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
