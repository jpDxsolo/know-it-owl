/**
 * A team playing a round.
 *
 * The host releases questions one at a time, so this screen is a pager over a
 * list that grows underneath it. Three things shape everything here:
 *
 * - **Nothing is sent until the team hands in.** One submission per team per
 *   round, server-enforced, so every keystroke lives in a local draft until
 *   then and any question can be re-opened and re-answered before it goes.
 * - **The team is on several phones.** Whoever presses submit decides what is
 *   sent, and the moment they do, everyone else's screen has to lock — which is
 *   why the team's own record of having handed in is what gates this screen,
 *   not anything this device remembers doing.
 * - **The double is a bet, not a setting.** It is spent once per game and
 *   cannot be taken back, so it is confirmed on the way out rather than
 *   toggled quietly.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useGame, type Game } from "../hooks/useGame";
import { useStatusRedirect } from "../hooks/useStatusRedirect";
import { ApiError, execute, SubmitAnswersMutation } from "../services/api";
import { clearRoundDraft, roundDraft, saveRoundDraft } from "../services/drafts";
import { playerId } from "../services/identity";
import "./TeamRound.css";

/** A PICTURE_10 is ten numbered things in one image, so it takes ten answers. */
const PICTURE_ANSWER_COUNT = 10;

type Round = Game["rounds"][number];
type Question = Round["questions"][number];
type Team = Game["teams"][number];

function answerCount(question: Question): number {
  return question.type === "PICTURE_10" ? PICTURE_ANSWER_COUNT : 1;
}

/**
 * A stored draft padded (or trimmed) to the shape this question needs. A draft
 * written before the host edited the round is not a reason to send the server
 * the wrong number of answers.
 */
function answersFor(question: Question, stored: string[] | undefined): string[] {
  return Array.from({ length: answerCount(question) }, (_, index) => stored?.[index] ?? "");
}

function isAnswered(answers: string[] | undefined): boolean {
  return (answers ?? []).some((answer) => answer.trim().length > 0);
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** 1 → 1st. Used for a team's place, which is read at a glance. */
export function ordinal(position: number): string {
  const tens = position % 100;
  if (tens >= 11 && tens <= 13) return `${position}th`;
  const suffix = ["th", "st", "nd", "rd"][position % 10] ?? "th";
  return `${position}${suffix}`;
}

/** Highest score first. Ties keep the order the server sent, which is stable. */
export function byScore(teams: readonly Team[]): Team[] {
  return [...teams].sort((left, right) => right.score - left.score);
}

export function TeamRound() {
  const { gameId } = useParams<{ gameId: string }>();
  const { game, realtime, loading, error, viewer } = useGame(gameId);
  useStatusRedirect(gameId, game?.status, viewer, "round");

  const me = playerId();
  const round = game?.rounds.find((candidate) => candidate.number === game.currentRound);
  const roundNumber = round?.number;
  const released = round?.releasedCount ?? 0;

  const myTeam = useMemo(
    () => game?.teams.find((team) => team.players.some((player) => player.id === me)),
    [game, me],
  );

  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [double, setDouble] = useState(false);
  const [current, setCurrent] = useState(1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  /**
   * Which round's draft is currently in state. A round change has to reload
   * from storage rather than carry the previous round's answers forward, and
   * this is also what stops the save below from writing an empty draft over a
   * real one on the first render.
   */
  const loadedRound = useRef<string>();
  useEffect(() => {
    if (!gameId || roundNumber === undefined) return;
    const token = `${gameId}.${roundNumber}`;
    if (loadedRound.current === token) return;
    loadedRound.current = token;
    const draft = roundDraft(gameId, roundNumber);
    setAnswers(draft?.answers ?? {});
    setDouble(draft?.double ?? false);
    // Open on the newest question out, so a mid-round reload lands where the
    // team was rather than back at question one.
    setCurrent(Math.max(1, released));
  }, [gameId, roundNumber, released]);

  useEffect(() => {
    if (!gameId || roundNumber === undefined) return;
    if (loadedRound.current !== `${gameId}.${roundNumber}`) return;
    saveRoundDraft(gameId, roundNumber, { answers, double });
  }, [gameId, roundNumber, answers, double]);

  /**
   * Follow the host — but only for a team that was keeping up.
   *
   * Jumping to each new question is what a team watching the screen wants. Doing
   * it to someone half-way through re-typing question 2 would throw their work
   * off screen mid-sentence, so the advance only happens when they were sitting
   * on what had been the newest question.
   */
  const previousReleased = useRef(released);
  useEffect(() => {
    const previous = previousReleased.current;
    previousReleased.current = released;
    if (released <= previous) return;
    setCurrent((at) => (at === previous || at < 1 ? released : at));
  }, [released]);

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

  if (!myTeam) {
    return (
      <main className="kio-page">
        <AppHeader realtime={realtime} />
        <h1>Not on a team yet</h1>
        <p className="kio-muted">Your host draws the teams before the first round starts.</p>
      </main>
    );
  }

  if (!round || roundNumber === undefined) {
    return (
      <main className="kio-page">
        <AppHeader realtime={realtime} />
        <h1>Nearly there</h1>
        <p className="kio-muted">Waiting for your host to start the round…</p>
      </main>
    );
  }

  const total = round.questionCount;
  const showing = Math.min(Math.max(current, 1), Math.max(released, 1));
  const question = round.questions.find((candidate) => candidate.number === showing);

  const handedIn = myTeam.lastSubmittedRound === roundNumber;
  const marking = round.status === "GRADING" || game.status === "GRADING";
  const allReleased = total > 0 && released >= total;

  const doubleUsedRound = myTeam.doubleUsedRound;
  const doubledThisRound = doubleUsedRound === roundNumber;
  const doubleSpent = doubleUsedRound !== null && !doubledThisRound;
  const doubleOn = doubledThisRound || double;

  const answeredCount = round.questions.filter((candidate) =>
    isAnswered(answers[candidate.number]),
  ).length;
  const unanswered = round.questions.length - answeredCount;

  const setAnswer = (questionNumber: number, index: number, value: string): void =>
    setAnswers((previous) => {
      const next = [...(previous[questionNumber] ?? [])];
      while (next.length <= index) next.push("");
      next[index] = value;
      return { ...previous, [questionNumber]: next };
    });

  async function submit(): Promise<void> {
    if (!gameId || !round) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await execute(SubmitAnswersMutation, {
        input: {
          gameId,
          playerId: me,
          roundNumber: round.number,
          answers: round.questions.map((candidate) => ({
            questionNumber: candidate.number,
            answers: answersFor(candidate, answers[candidate.number]),
          })),
          double: doubleOn,
        },
      });
      // The round belongs to the server now; keeping the draft would restore it
      // as though it were still editable.
      clearRoundDraft(gameId, round.number);
      setConfirming(false);
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : String(cause));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  /** A double or a gap is worth a second look; a full sheet is not. */
  const trySubmit = (): void => {
    if (doubleOn || unanswered > 0) setConfirming(true);
    else void submit();
  };

  const standings = byScore(game.teams);
  const place = standings.findIndex((team) => team.id === myTeam.id) + 1;

  const helper = handedIn
    ? marking
      ? "Answers are in. Your host is marking."
      : "Answers are in. Sit tight."
    : !allReleased
      ? `Your host has released ${released} of ${total} questions.`
      : `${answeredCount} of ${round.questions.length} answered — you can edit until you submit.`;

  return (
    <main className="kio-page kio-page--wide kio-round">
      <AppHeader realtime={realtime} />

      <div className="kio-round__layout">
        <aside className="kio-round__panel">
          <button
            className="kio-round__panelToggle"
            type="button"
            aria-expanded={panelOpen}
            aria-controls="teamPanel"
            onClick={() => setPanelOpen((open) => !open)}
          >
            <span className="kio-round__panelTeam">{myTeam.name}</span>
            <span className="kio-muted">
              {myTeam.players.length} {myTeam.players.length === 1 ? "player" : "players"} ·{" "}
              {place > 0 ? `${ordinal(place)} of ${standings.length}` : "unranked"} · {myTeam.score}{" "}
              pts
            </span>
          </button>

          <div
            id="teamPanel"
            className={`kio-round__panelBody${panelOpen ? " kio-round__panelBody--open" : ""}`}
          >
            <div>
              <h2 className="kio-label">Your team</h2>
              <p className="kio-round__panelName">{myTeam.name}</p>
              <ul className="kio-team__players">
                {myTeam.players.map((player) => (
                  <li key={player.id} className="kio-chip">
                    <span className="kio-chip__avatar" aria-hidden="true">
                      {initial(player.displayName)}
                    </span>
                    {player.displayName}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="kio-label">Standings</h2>
              <ol className="kio-round__standings">
                {standings.map((team, index) => (
                  <li
                    key={team.id}
                    className={`kio-round__standing${
                      team.id === myTeam.id ? " kio-round__standing--mine" : ""
                    }`}
                  >
                    <span className="kio-round__place">{index + 1}</span>
                    <span className="kio-round__standingName">{team.name}</span>
                    <span className="kio-round__score">{team.score}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </aside>

        <section className="kio-round__main">
          <header className="kio-round__head">
            <p className="kio-label">Round {round.number}</p>
            <h1 className="kio-round__title">{round.category}</h1>
          </header>

          {handedIn && (
            <p className="kio-round__locked" role="status">
              <strong>Answers are in.</strong> One of you handed in for the team, so this round is
              locked.
            </p>
          )}

          {released === 0 ? (
            <p className="kio-muted">
              Your host hasn&rsquo;t let the first question out yet. It will appear here.
            </p>
          ) : (
            <>
              <div className="kio-pager">
                <button
                  className="kio-pager__step"
                  type="button"
                  aria-label="Previous question"
                  onClick={() => setCurrent(showing - 1)}
                  disabled={showing <= 1}
                >
                  ←
                </button>
                <p className="kio-pager__count">
                  Question {showing} of {total}
                </p>
                <button
                  className="kio-pager__step"
                  type="button"
                  aria-label="Next question"
                  onClick={() => setCurrent(showing + 1)}
                  disabled={showing >= released}
                >
                  →
                </button>
              </div>

              <ol className="kio-pager__dots">
                {Array.from({ length: Math.max(total, released) }, (_, index) => {
                  const number = index + 1;
                  const locked = number > released;
                  const state = locked
                    ? "locked"
                    : isAnswered(answers[number])
                      ? "answered"
                      : "blank";
                  return (
                    <li key={number}>
                      <button
                        className={`kio-pager__dot kio-pager__dot--${state}${
                          number === showing ? " kio-pager__dot--current" : ""
                        }`}
                        type="button"
                        onClick={() => setCurrent(number)}
                        disabled={locked}
                        aria-current={number === showing ? "true" : undefined}
                        aria-label={
                          locked ? `Question ${number}, not released yet` : `Question ${number}`
                        }
                      >
                        {number}
                      </button>
                    </li>
                  );
                })}
              </ol>

              {question && (
                <div className="kio-card kio-question">
                  {question.type === "PICTURE_10" ? (
                    <>
                      {question.imageUrl ? (
                        /*
                         * A plain link to the image, so the browser's own viewer
                         * does the work: full size, pinch-zoom on a phone, and
                         * save by long-press or right-click. Anything built in
                         * here would be a worse version of all three.
                         */
                        <a
                          className="kio-picture-link"
                          href={question.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <img
                            className="kio-question__image"
                            src={question.imageUrl}
                            alt={`Picture round, question ${question.number}`}
                          />
                          <span className="kio-picture-link__hint">
                            Open full size ↗
                          </span>
                        </a>
                      ) : (
                        <p className="kio-muted">The picture is on its way…</p>
                      )}
                      <p className="kio-muted">
                        Ten numbered things in one picture. Worth {question.defaultPoints}{" "}
                        {question.defaultPoints === 1 ? "point" : "points"} each.
                      </p>
                      <ol className="kio-answers">
                        {answersFor(question, answers[question.number]).map((value, index) => (
                          <li key={index} className="kio-answers__row">
                            <label
                              className="kio-answers__number"
                              htmlFor={`answer-${question.number}-${index}`}
                            >
                              {index + 1}
                            </label>
                            <input
                              id={`answer-${question.number}-${index}`}
                              className="kio-input"
                              value={value}
                              onChange={(event) =>
                                setAnswer(question.number, index, event.target.value)
                              }
                              disabled={handedIn}
                              aria-label={`Answer ${index + 1}`}
                            />
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : (
                    <>
                      <p className="kio-question__prompt">{question.text}</p>
                      <p className="kio-muted">
                        Worth {question.defaultPoints}{" "}
                        {question.defaultPoints === 1 ? "point" : "points"}
                      </p>
                      <label className="kio-label" htmlFor={`answer-${question.number}`}>
                        Your answer
                      </label>
                      <textarea
                        id={`answer-${question.number}`}
                        className="kio-input kio-question__answer"
                        rows={2}
                        value={answersFor(question, answers[question.number])[0] ?? ""}
                        onChange={(event) => setAnswer(question.number, 0, event.target.value)}
                        disabled={handedIn}
                      />
                    </>
                  )}
                  {!handedIn && <p className="kio-muted">Saved on this device.</p>}
                </div>
              )}
            </>
          )}

          {/*
            * A round the host closed to doubling shows no switch at all, rather
            * than a disabled one. A disabled control reads as "you cannot do
            * this yet"; there is no yet here, and the server refuses it anyway.
            */}
          {!round.doublingAllowed ? (
            <p className="kio-muted kio-round__noDouble">
              No doubling on this round — your host has turned it off.
            </p>
          ) : (
          <section
            className={`kio-card kio-double${doubleOn ? " kio-double--on" : ""}`}
            aria-labelledby="doubleTitle"
          >
            <div>
              <h2 className="kio-double__title" id="doubleTitle">
                Double this round
              </h2>
              <p className="kio-muted">
                {doubleSpent
                  ? `Spent already — you doubled round ${doubleUsedRound}.`
                  : doubledThisRound
                    ? "Locked in. This round counts twice."
                    : "Twice the points, once per game. Nothing is spent until you hand in."}
              </p>
            </div>
            <button
              className="kio-switch"
              type="button"
              role="switch"
              aria-checked={doubleOn}
              aria-label="Double this round"
              onClick={() => setDouble((on) => !on)}
              disabled={doubleSpent || doubledThisRound || handedIn}
            >
              <span className="kio-switch__knob" aria-hidden="true" />
            </button>
          </section>
          )}

          {problem && <p className="kio-field-error">{problem}</p>}

          <div className="kio-round__foot">
            <button
              className="kio-button kio-button--primary"
              type="button"
              onClick={trySubmit}
              disabled={handedIn || busy || !allReleased}
            >
              {handedIn ? "Handed in" : busy ? "Sending…" : "Submit answers"}
            </button>
            <p className="kio-muted">{helper}</p>
          </div>
        </section>
      </div>

      {confirming && (
        <div className="kio-confirm" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
          <div className="kio-card kio-confirm__box">
            <h2 className="kio-confirm__title" id="confirmTitle">
              {doubleOn ? `Double round ${round.number}?` : "Hand in now?"}
            </h2>
            {doubleOn && (
              <p className="kio-muted">
                This round counts twice, and your double is gone for the rest of the game.
              </p>
            )}
            {unanswered > 0 && (
              <p className="kio-muted">
                {unanswered} of {round.questions.length}{" "}
                {unanswered === 1 ? "question has" : "questions have"} no answer yet.
              </p>
            )}
            <p className="kio-muted">
              One submission per team — nobody can edit this round afterwards.
            </p>
            <div className="kio-confirm__actions">
              <button
                className="kio-button kio-button--secondary"
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                Keep editing
              </button>
              <button
                className="kio-button kio-button--primary"
                type="button"
                onClick={() => void submit()}
                disabled={busy}
              >
                {busy ? "Sending…" : "Hand in"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
