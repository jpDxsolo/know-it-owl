/**
 * The host's control panel, from an empty lobby to a round being marked.
 *
 * One screen rather than four, because it is one job — running the quiz — and
 * the host should never have to go looking for the next control. What changes
 * between states is which panel leads, not where things live.
 */
import { useRef, useState, type ChangeEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { RoundBuilder } from "../components/RoundBuilder";
import { useGmGame } from "../hooks/useGmGame";
import type { Game } from "../hooks/useGame";
import {
  ApiError,
  CreateRoundMutation,
  execute,
  RandomizeTeamsMutation,
  ReleaseQuestionMutation,
  StartRoundMutation,
} from "../services/api";
import {
  parseQuizFile,
  quizFileName,
  QuizFileError,
  toQuestionInputs,
  toQuizFile,
} from "../services/quizFile";
import "./GmDashboard.css";

/*
 * One team is allowed.
 *
 * A single team playing alone is how the game gets tested end to end, and the
 * server has always permitted it — `randomizeTeams` takes a count with a
 * minimum of one and only refuses more teams than there are players. This was
 * a frontend rule with nothing behind it.
 */
const MIN_TEAMS = 1;
/** What a quiz night usually wants, and what the stepper starts on. */
const DEFAULT_TEAMS = 2;

type Round = Game["rounds"][number];

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Rounds that are still being played or marked, as opposed to finished. */
const IN_PLAY = new Set(["ACTIVE", "GRADING"]);

/**
 * The round the host is running, if any.
 *
 * Matching on the number alone was not enough: `currentRound` still points at
 * the round that was just revealed, so the host was shown the live panel for a
 * finished round — release controls for questions already out, and no sign of
 * the "New round" and "Start round" controls that live in the other view. The
 * quiz appeared to end after one round.
 */
function activeRound(game: Game): Round | undefined {
  return game.rounds.find(
    (round) => round.number === game.currentRound && IN_PLAY.has(round.status),
  );
}

/** The first round written but not yet played. */
function nextDraft(game: Game): Round | undefined {
  return game.rounds.find((round) => round.status === "DRAFT");
}

export function GmDashboard() {
  const { gameId } = useParams<{ gameId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const routed = location.state as { justCreated?: boolean; tieBreaker?: boolean } | null;
  const justCreated = routed?.justCreated === true;
  /* Sent here from the reveal screen when the top of the table is level. */
  const tieBreaker = routed?.tieBreaker === true;

  const { game, realtime, loading, error, gmToken, isHost, submittedTeamIds, refresh } =
    useGmGame(gameId);

  const [teamCount, setTeamCount] = useState(DEFAULT_TEAMS);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [building, setBuilding] = useState(tieBreaker);
  const [noticeSeen, setNoticeSeen] = useState(false);
  const [opening, setOpening] = useState(false);
  /* A hidden input, so the file picker can sit behind an ordinary button. */
  const quizInput = useRef<HTMLInputElement>(null);

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

  /**
   * Refuse a deep link this browser cannot act on.
   *
   * The token lives in the browser that created the game and the server keeps
   * only a hash, so there is genuinely nothing to do here — but say *why*,
   * because "no access" on your own quiz is baffling otherwise.
   */
  if (!isHost || !gameId || !gmToken) {
    return (
      <main className="kio-page">
        <AppHeader />
        <h1>Not your game to run</h1>
        <p className="kio-muted">
          The host key is kept in the browser that started this game, and never leaves it. Open
          this page there, or start a new game.
        </p>
      </main>
    );
  }

  if (loading && !game) {
    return (
      <main className="kio-page">
        <AppHeader realtime={realtime} />
        <p className="kio-muted">Loading your game…</p>
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

  const teamsDrawn = game.teams.length > 0;
  // A wish, clamped to the people actually here — see the stepper in Lobby.
  const teams = Math.min(teamCount, Math.max(game.players.length, MIN_TEAMS));
  const running = activeRound(game);
  const draft = nextDraft(game);

  const copyCode = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(game.joinCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The code is on screen in large type; copying is a convenience.
    }
  };

  const drawTeams = () =>
    run(async () => {
      await execute(RandomizeTeamsMutation, { gameId, gmToken, teamCount: teams });
    });

  /**
   * Write the rounds out as a file.
   *
   * The blob is same-origin and revoked straight after, so this is a download
   * and not a navigation. Only the host can do it, and only the host's view
   * carries the answer keys and image keys that make the file worth having.
   */
  const exportQuiz = (): void => {
    if (!game || game.rounds.length === 0) return;
    const name = `Know It Owl ${new Date().toISOString().slice(0, 10)}`;
    const file = toQuizFile(name, game.rounds);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = quizFileName(name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  /**
   * Open a saved quiz into this game.
   *
   * Rounds are created one at a time and in order, because `createRound`
   * assigns the next number itself — firing them together would number them by
   * whichever transaction landed first, and a quiz would come out shuffled.
   */
  async function openQuiz(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const chosen = event.target.files?.[0];
    // Let the same file be chosen again after a failure.
    event.target.value = "";
    if (!chosen || !gameId || !gmToken) return;

    setOpening(true);
    setProblem(undefined);
    try {
      const quiz = parseQuizFile(await chosen.text());
      for (const round of quiz.rounds) {
        await execute(CreateRoundMutation, {
          gameId,
          gmToken,
          category: round.category,
          questions: toQuestionInputs(round),
          doublingAllowed: round.doublingAllowed,
        });
      }
      refresh();
    } catch (cause) {
      setProblem(
        cause instanceof QuizFileError || cause instanceof ApiError
          ? cause.message
          : String(cause),
      );
    } finally {
      setOpening(false);
    }
  }

  const startRound = (roundNumber: number) =>
    run(async () => {
      await execute(StartRoundMutation, { gameId, gmToken, roundNumber });
    });

  const releaseNext = (roundNumber: number, questionNumber: number) =>
    run(async () => {
      await execute(ReleaseQuestionMutation, { gameId, gmToken, roundNumber, questionNumber });
    });

  if (building) {
    return (
      <main className="kio-page kio-page--wide">
        <AppHeader realtime={realtime} />
        <RoundBuilder
          gameId={gameId}
          gmToken={gmToken}
          roundNumber={game.rounds.length + 1}
          initialCategory={tieBreaker ? "Tie-breaker" : ""}
          singleQuestion={tieBreaker}
          onSaved={() => {
            setBuilding(false);
            // `createRound` is the one mutation the host makes that fans out to
            // nobody — it returns a Round rather than a GameUpdate, by design,
            // since a DRAFT round is not news to the players. So nothing tells
            // this screen its own round list just grew, and without this the
            // round the host has just written is missing from the list and
            // cannot be started until something else forces a re-read.
            refresh();
          }}
          onCancel={() => setBuilding(false)}
        />
      </main>
    );
  }

  return (
    <main className="kio-page kio-page--wide kio-gm">
      <AppHeader realtime={realtime} />

      {justCreated && !noticeSeen && (
        <aside className="kio-notice">
          <p className="kio-notice__title">This browser is now the host</p>
          <p className="kio-muted">
            Your host key is stored here and nowhere else — we can&rsquo;t send you another one.
            Finish the quiz on this device.
          </p>
          <button
            className="kio-button kio-button--secondary"
            type="button"
            onClick={() => setNoticeSeen(true)}
          >
            Got it
          </button>
        </aside>
      )}

      {running ? (
        <LiveRound
          game={game}
          round={running}
          submittedTeamIds={submittedTeamIds}
          busy={busy}
          onRelease={releaseNext}
          onMark={() => navigate(`/game/${gameId}/gm/grading`)}
        />
      ) : (
        <>
          <section className="kio-gm__code">
            <h2 className="kio-label">Game code</h2>
            <div className="kio-gm__codeRow">
              <p className="kio-gm__codeValue">{game.joinCode}</p>
              <button className="kio-button kio-button--ghost" type="button" onClick={copyCode}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </section>

          <div className="kio-gm__panels">
            <section>
              <div className="kio-gm__panelHead">
                <h2 className="kio-gm__panelTitle">Teams</h2>
                <p className="kio-muted">
                  {teamsDrawn && `${game.teams.length} teams · `}
                  {game.players.length} {game.players.length === 1 ? "player" : "players"}
                </p>
              </div>

              {teamsDrawn ? (
                <ul className="kio-gm__teams">
                  {game.teams.map((team) => (
                    <li key={team.id} className="kio-card">
                      <h3 className="kio-gm__teamName">{team.name}</h3>
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
              ) : game.players.length === 0 ? (
                <p className="kio-muted">Nobody yet. Read the code out and they&rsquo;ll appear.</p>
              ) : (
                <ul className="kio-team__players">
                  {game.players.map((player) => (
                    <li key={player.id} className="kio-chip">
                      <span className="kio-chip__avatar" aria-hidden="true">
                        {initial(player.displayName)}
                      </span>
                      {player.displayName}
                    </li>
                  ))}
                </ul>
              )}

              {!teamsDrawn && (
                <div className="kio-gm__draw">
                  <label className="kio-label" htmlFor="teamCount">
                    Teams
                  </label>
                  <input
                    id="teamCount"
                    className="kio-input kio-gm__teamCount"
                    type="number"
                    min={MIN_TEAMS}
                    max={Math.max(MIN_TEAMS, game.players.length)}
                    value={teams}
                    onChange={(event) =>
                      setTeamCount(Math.max(MIN_TEAMS, Number(event.target.value) || MIN_TEAMS))
                    }
                  />
                </div>
              )}

              <button
                className={`kio-button ${teamsDrawn ? "kio-button--secondary" : "kio-button--primary"}`}
                type="button"
                onClick={drawTeams}
                disabled={busy || game.players.length === 0}
              >
                {teamsDrawn ? "Re-draw teams" : "Draw the teams"}
              </button>
              {game.players.length === 0 && (
                <p className="kio-muted">Waiting for someone to join.</p>
              )}
            </section>

            <section>
              <div className="kio-gm__panelHead">
                <h2 className="kio-gm__panelTitle">Rounds</h2>
                <p className="kio-muted">
                  {game.rounds.length} written
                </p>
              </div>

              <ul className="kio-gm__rounds">
                {game.rounds.map((round) => (
                  <li key={round.number} className="kio-card kio-round">
                    <div>
                      <p className="kio-round__name">
                        Round {round.number} · {round.category}
                      </p>
                      <p className="kio-muted">
                        {round.questions.length}{" "}
                        {round.questions.length === 1 ? "question" : "questions"}
                      </p>
                    </div>
                    <span className={`kio-tag kio-tag--${round.status.toLowerCase()}`}>
                      {round.status === "DRAFT" ? "Ready" : round.status.toLowerCase()}
                    </span>
                  </li>
                ))}
                <li>
                  <button
                    className="kio-builder__add"
                    type="button"
                    onClick={() => setBuilding(true)}
                  >
                    + New round
                  </button>
                </li>
              </ul>

              {/*
                * A quiz written once and opened whenever you play it, rather
                * than written on the night. There is no storage behind this —
                * the file is the quiz.
                */}
              <div className="kio-gm__quizFile">
                <button
                  className="kio-button kio-button--ghost"
                  type="button"
                  onClick={() => quizInput.current?.click()}
                  disabled={opening}
                >
                  {opening ? "Opening…" : "Open a quiz file"}
                </button>
                <button
                  className="kio-button kio-button--ghost"
                  type="button"
                  onClick={exportQuiz}
                  disabled={game.rounds.length === 0}
                >
                  Save this quiz to a file
                </button>
                <input
                  ref={quizInput}
                  className="kio-sr-only"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void openQuiz(event)}
                  aria-label="Open a quiz file"
                />
              </div>
            </section>
          </div>

          {problem && <p className="kio-field-error">{problem}</p>}

          <div className="kio-gm__foot">
            <button
              className="kio-button kio-button--primary"
              type="button"
              onClick={() => draft && startRound(draft.number)}
              disabled={busy || !draft || !teamsDrawn}
            >
              {draft ? `Start round ${draft.number}` : "Start a round"}
            </button>
            {!teamsDrawn && <p className="kio-muted">Draw the teams first.</p>}
            {teamsDrawn && !draft && <p className="kio-muted">Write a round first.</p>}
          </div>
        </>
      )}
    </main>
  );
}

interface LiveRoundProps {
  game: Game;
  round: Round;
  submittedTeamIds: ReadonlySet<string>;
  busy: boolean;
  onRelease: (roundNumber: number, questionNumber: number) => void;
  onMark: () => void;
}

/**
 * The round in play: unveil the questions one at a time, and watch the teams
 * hand in. Release is strictly sequential, so there is only ever one next.
 */
function LiveRound({ game, round, submittedTeamIds, busy, onRelease, onMark }: LiveRoundProps) {
  const total = round.questions.length;
  const released = round.releasedCount;
  const nextNumber = released + 1;
  const everyoneIn =
    game.teams.length > 0 && game.teams.every((team) => submittedTeamIds.has(team.id));

  return (
    <>
      <div className="kio-gm__panelHead">
        <h1 className="kio-gm__panelTitle">
          Round {round.number} · {round.category}
        </h1>
        <p className="kio-muted">
          Question {released} of {total} released
        </p>
      </div>

      <div className="kio-gm__panels">
        <section>
          <ol className="kio-gm__questions">
            {round.questions.map((question) => {
              const isNext = question.number === nextNumber;
              const isReleased = question.number <= released;
              return (
                <li
                  key={question.number}
                  className={`kio-card kio-liveq${isNext ? " kio-liveq--next" : ""}${
                    !isReleased && !isNext ? " kio-liveq--locked" : ""
                  }`}
                >
                  <div className="kio-liveq__body">
                    <p className="kio-muted">Question {question.number}</p>
                    <p className="kio-liveq__text">
                      {question.type === "PICTURE_10" ? "Picture round" : question.text}
                    </p>
                  </div>
                  {isReleased ? (
                    <span className="kio-tag kio-tag--released">Released</span>
                  ) : isNext ? (
                    <button
                      className="kio-button kio-button--primary kio-liveq__release"
                      type="button"
                      onClick={() => onRelease(round.number, question.number)}
                      disabled={busy}
                    >
                      Release next
                    </button>
                  ) : (
                    <span className="kio-tag">Locked</span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        <section>
          <div className="kio-gm__panelHead">
            <h2 className="kio-gm__panelTitle">Submissions</h2>
            <p className="kio-muted">
              {submittedTeamIds.size} of {game.teams.length} teams in
            </p>
          </div>
          <ul className="kio-gm__teams">
            {game.teams.map((team) => {
              const handedIn = submittedTeamIds.has(team.id);
              return (
                <li key={team.id} className="kio-card kio-submission">
                  <span>{team.name}</span>
                  <span className={`kio-tag${handedIn ? " kio-tag--released" : ""}`}>
                    {handedIn ? "Handed in" : "Still writing"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/*
        * Marking comes between the last hand-in and the reveal, and this is the
        * only way into it: the game does not reach GRADING until a first answer
        * is marked, so a host sent straight to the reveal from here could never
        * get to the marking sheet at all — and would reveal a round in which
        * every team scored nothing. The reveal lives on that sheet, behind
        * having actually marked the answers.
        */}
      <div className="kio-gm__foot">
        <button
          className="kio-button kio-button--primary"
          type="button"
          onClick={onMark}
          disabled={busy || !everyoneIn}
        >
          Mark the answers
        </button>
        {!everyoneIn && <p className="kio-muted">Every team has to hand in before you can mark.</p>}
      </div>
    </>
  );
}
