/**
 * The host marking a round.
 *
 * Two rules shape the whole screen, and both come from the scoring model rather
 * than from taste:
 *
 * - **The typed number is final.** Nothing here multiplies, scales or infers a
 *   score from the answer key. Every box is directly editable and what is in it
 *   is what the team gets, which keeps partial credit, a generous ruling and a
 *   contested answer all in one place a human can explain.
 * - **A doubled team is the host's problem, loudly.** Because nothing is
 *   multiplied, a doubled round is only doubled if the host types the doubled
 *   number — so the badge saying so has to be impossible to miss.
 *
 * It is a grid of every team's answers, which is a shape that needs width, so
 * this is designed at desktop and folded into one column on a phone.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useGmGame } from "../hooks/useGmGame";
import { useRoundResults, type RoundResult, type TeamResponse } from "../hooks/useRoundResults";
import { useStatusRedirect } from "../hooks/useStatusRedirect";
import { ApiError, EndRoundMutation, execute, GradeResponseMutation } from "../services/api";
import "./GmGrading.css";

const PICTURE_ANSWER_COUNT = 10;

type Question = RoundResult["round"]["questions"][number];

function expectedPoints(question: Question): number {
  return question.type === "PICTURE_10" ? PICTURE_ANSWER_COUNT : 1;
}

/** One response's identity, used to key the host's in-flight edits. */
function slot(questionNumber: number, teamId: string): string {
  return `${questionNumber}:${teamId}`;
}

/** A blank box means "not marked yet"; on the way out it is worth nothing. */
function toPoints(values: readonly string[], expected: number): number[] {
  return Array.from({ length: expected }, (_, index) => {
    const parsed = Number.parseInt(values[index] ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  });
}

export function GmGrading() {
  const { gameId } = useParams<{ gameId: string }>();
  const { game, realtime, loading, error, viewer, gmToken, isHost, lastEvent } = useGmGame(gameId);
  useStatusRedirect(gameId, game?.status, viewer, "gm/grading");

  const roundNumber = game?.currentRound ?? null;
  const { results, loading: reading, refresh } = useRoundResults(gameId, roundNumber, gmToken);

  /**
   * What the host has typed but the server has not confirmed back yet. Kept as
   * an overlay rather than seeded into state, so a re-read landing mid-keystroke
   * cannot take a number back out from under them.
   */
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  /** The marking sheet, so Enter can find the next points box in it. */
  const sheet = useRef<HTMLOListElement>(null);

  // A team handing in late is a new column of answers to mark.
  useEffect(() => {
    if (lastEvent?.event === "ANSWERS_SUBMITTED") refresh();
  }, [lastEvent, refresh]);

  if (!isHost || !gameId || !gmToken) {
    return (
      <main className="kio-page">
        <AppHeader />
        <h1>Not your game to run</h1>
        <p className="kio-muted">
          The host key is kept in the browser that started this game, and never leaves it. Open
          this page there.
        </p>
      </main>
    );
  }

  if ((loading && !game) || (reading && !results)) {
    return (
      <main className="kio-page">
        <AppHeader realtime={realtime} />
        <p className="kio-muted">Fetching the answers…</p>
      </main>
    );
  }

  if (!game || !results || roundNumber === null) {
    return (
      <main className="kio-page">
        <AppHeader realtime={realtime} />
        <p className="kio-field-error">
          {error ? error.message : "There is no round waiting to be marked."}
        </p>
      </main>
    );
  }

  const round = results.round;
  const teams = game.teams;
  const responseFor = (questionNumber: number, teamId: string): TeamResponse | undefined =>
    results.responses.find(
      (entry) => entry.questionNumber === questionNumber && entry.teamId === teamId,
    );

  const marked = results.responses.filter((entry) => entry.graded).length;
  const toMark = results.responses.length;
  const outstanding = toMark - marked;

  const valuesFor = (question: Question, response: TeamResponse | undefined): string[] => {
    const expected = expectedPoints(question);
    const typed = response ? edits[slot(question.number, response.teamId)] : undefined;
    if (typed) return Array.from({ length: expected }, (_, index) => typed[index] ?? "");
    return Array.from({ length: expected }, (_, index) => {
      const stored = response?.gradedPoints?.[index];
      return stored === undefined || stored === null ? "" : String(stored);
    });
  };

  /** One grade, with no re-read of its own: callers decide when to refresh. */
  async function gradeOne(
    question: Question,
    response: TeamResponse,
    values: string[],
  ): Promise<void> {
    if (!gameId || !gmToken) return;
    await execute(GradeResponseMutation, {
      input: {
        gameId,
        gmToken,
        roundNumber: response.roundNumber,
        questionNumber: question.number,
        teamId: response.teamId,
        points: toPoints(values, expectedPoints(question)),
      },
    });
  }

  interface Entry {
    response: TeamResponse;
    values: string[];
  }

  /**
   * Save one grade or a whole question's worth, then re-read once.
   *
   * Sequential rather than parallel: `gradeResponse` also walks the round and
   * the game into GRADING, so a burst of them is a burst of conditional writes
   * to the same two items — and the loser of that race comes back as a conflict
   * the host did nothing to deserve.
   */
  async function send(question: Question, entries: Entry[]): Promise<void> {
    if (entries.length === 0) return;
    setProblem(undefined);
    try {
      for (const entry of entries) await gradeOne(question, entry.response, entry.values);
      refresh();
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : String(cause));
    }
  }

  const type = (question: Question, response: TeamResponse, index: number, value: string): void =>
    setEdits((previous) => {
      const key = slot(question.number, response.teamId);
      const next = [...(previous[key] ?? valuesFor(question, response))];
      next[index] = value;
      return { ...previous, [key]: next };
    });

  const filled = (question: Question, points: number): string[] =>
    Array.from({ length: expectedPoints(question) }, () => String(points));

  /** A quick mark: fill every box for this response and save it immediately. */
  const markAll = (question: Question, response: TeamResponse, points: number): void => {
    const values = filled(question, points);
    setEdits((previous) => ({ ...previous, [slot(question.number, response.teamId)]: values }));
    void send(question, [{ response, values }]);
  };

  /**
   * Mark a whole question in one go.
   *
   * `onlyUnmarked` is the one a host actually reaches for: having gone down the
   * column giving marks to the teams that earned them, the rest are noughts, and
   * with the reveal gated on everything being marked those noughts have to be
   * entered rather than left blank.
   */
  const markQuestion = (question: Question, points: number, onlyUnmarked: boolean): void => {
    const entries = results.responses
      .filter((response) => response.questionNumber === question.number)
      .filter((response) => !onlyUnmarked || !response.graded)
      .map((response) => ({ response, values: filled(question, points) }));
    setEdits((previous) => {
      const next = { ...previous };
      for (const entry of entries) next[slot(question.number, entry.response.teamId)] = entry.values;
      return next;
    });
    void send(question, entries);
  };

  /**
   * Enter moves down the column of points boxes.
   *
   * A host marks by reading across a row and typing a number, over and over, so
   * the fastest path is one key between entries. Moving focus fires the blur
   * that saves, so this is only navigation. DOM order is the visual order, which
   * is why the boxes are found by query rather than tracked in state.
   */
  const onPointsKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const boxes = Array.from(
      sheet.current?.querySelectorAll<HTMLInputElement>("input.kio-marking__points") ?? [],
    );
    const next = boxes[boxes.indexOf(event.currentTarget) + 1];
    if (next) next.focus();
    else event.currentTarget.blur();
  };

  const endRound = async (): Promise<void> => {
    if (!gameId || !gmToken) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await execute(EndRoundMutation, { gameId, gmToken, roundNumber });
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="kio-page kio-page--wide kio-grading">
      <AppHeader realtime={realtime} />

      <header className="kio-grading__head">
        <h1 className="kio-grading__title">
          Marking round {round.number} · {round.category}
        </h1>
        <p className="kio-muted">
          {teams.length} {teams.length === 1 ? "team" : "teams"} · {marked} of {toMark} marked
        </p>
        {/* Native, so the width comes from the value rather than an inline style. */}
        <progress
          className="kio-grading__progress"
          value={marked}
          max={Math.max(toMark, 1)}
          aria-label="Answers marked"
        />
      </header>

      <ol className="kio-grading__questions" ref={sheet}>
        {round.questions.map((question) => (
          <li key={question.number} className="kio-card kio-marking">
            <div className="kio-marking__head">
              <p className="kio-label">
                Question {question.number} · worth {question.defaultPoints}{" "}
                {question.defaultPoints === 1 ? "point" : "points"}
              </p>
              <p className="kio-marking__prompt">
                {question.type === "PICTURE_10" ? "Picture round" : question.text}
              </p>
              <p className="kio-marking__key">
                <span className="kio-label">Correct</span>
                {(question.correctAnswers ?? []).join(" · ") || "No answer key"}
              </p>
              {/* Out of the tab order on purpose, here and on every row below.
                  A host tabbing down the column wants the next points box, not
                  two buttons on the way to it — and nothing is lost, because
                  each of these only types a number the box accepts anyway. */}
              <div className="kio-marking__quick">
                <button
                  className="kio-button kio-button--ghost"
                  type="button"
                  tabIndex={-1}
                  onClick={() => markQuestion(question, question.defaultPoints, false)}
                >
                  Everyone right
                </button>
                <button
                  className="kio-button kio-button--ghost"
                  type="button"
                  tabIndex={-1}
                  onClick={() => markQuestion(question, 0, true)}
                >
                  Nought the rest
                </button>
              </div>
            </div>

            <ul className="kio-marking__teams">
              {teams.map((team) => {
                const response = responseFor(question.number, team.id);
                const values = valuesFor(question, response);
                return (
                  <li
                    key={team.id}
                    className={`kio-marking__team${
                      response?.doubled ? " kio-marking__team--doubled" : ""
                    }`}
                  >
                    <div className="kio-marking__who">
                      <span className="kio-marking__teamName">{team.name}</span>
                      {response?.doubled && (
                        <span className="kio-marking__doubled">DOUBLED ×2</span>
                      )}
                    </div>

                    {!response ? (
                      <p className="kio-muted">Nothing handed in.</p>
                    ) : question.type === "PICTURE_10" ? (
                      <>
                        <ol className="kio-marking__slots">
                          {values.map((value, index) => (
                            <li key={index} className="kio-marking__slot">
                              <span className="kio-marking__slotNumber">{index + 1}</span>
                              <span className="kio-marking__said">
                                {response.answers[index] || "—"}
                              </span>
                              <input
                                className="kio-input kio-marking__points"
                                type="number"
                                min={0}
                                inputMode="numeric"
                                value={value}
                                onChange={(event) =>
                                  type(question, response, index, event.target.value)
                                }
                                onBlur={() =>
                                  void send(question, [
                                    { response, values: valuesFor(question, response) },
                                  ])
                                }
                                onKeyDown={onPointsKeyDown}
                                aria-label={`Points for ${team.name}, item ${index + 1}`}
                              />
                            </li>
                          ))}
                        </ol>
                        <div className="kio-marking__quick">
                          <button
                            className="kio-button kio-button--ghost"
                            type="button"
                            tabIndex={-1}
                            onClick={() => markAll(question, response, question.defaultPoints)}
                          >
                            All right
                          </button>
                          <button
                            className="kio-button kio-button--ghost"
                            type="button"
                            tabIndex={-1}
                            onClick={() => markAll(question, response, 0)}
                          >
                            All wrong
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="kio-marking__answer">
                        <p className="kio-marking__said">{response.answers[0] || "—"}</p>
                        <div className="kio-marking__quick">
                          <button
                            className="kio-button kio-button--ghost"
                            type="button"
                            tabIndex={-1}
                            onClick={() => markAll(question, response, question.defaultPoints)}
                          >
                            Full
                          </button>
                          <button
                            className="kio-button kio-button--ghost"
                            type="button"
                            tabIndex={-1}
                            onClick={() => markAll(question, response, 0)}
                          >
                            Nought
                          </button>
                          <input
                            className="kio-input kio-marking__points"
                            type="number"
                            min={0}
                            inputMode="numeric"
                            value={values[0] ?? ""}
                            onChange={(event) => type(question, response, 0, event.target.value)}
                            onBlur={() =>
                              void send(question, [
                                { response, values: valuesFor(question, response) },
                              ])
                            }
                            onKeyDown={onPointsKeyDown}
                            aria-label={`Points for ${team.name}`}
                          />
                        </div>
                      </div>
                    )}

                    {response?.doubled && (
                      <p className="kio-marking__doubledNote">
                        This team doubled. Type the doubled value yourself — nothing is multiplied
                        for you.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>

      {problem && <p className="kio-field-error">{problem}</p>}

      <div className="kio-grading__foot">
        <button
          className="kio-button kio-button--primary"
          type="button"
          onClick={() => void endRound()}
          disabled={busy || outstanding > 0}
        >
          End round and reveal
        </button>
        {/* A reveal is the moment the scores become the standings, and an
            unmarked answer silently scores nothing — so the round cannot be
            revealed until the host has said what every answer was worth, even
            if what it was worth is nought. */}
        <p className="kio-muted">
          {outstanding > 0
            ? `${outstanding} ${outstanding === 1 ? "answer is" : "answers are"} still unmarked. Mark them — "Nought the rest" does a question at a time.`
            : "Everything is marked."}
        </p>
      </div>
    </main>
  );
}
