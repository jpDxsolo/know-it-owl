/**
 * Where a player starts: a code read aloud across a noisy room, and a name.
 *
 * The code field is the hero of the screen because it is the thing being
 * shouted over a pub. Everything else is deliberately quiet.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { ApiError, CreateGameMutation, execute, JoinGameMutation } from "../services/api";
import {
  displayName as storedName,
  lastGame,
  playerId,
  setDisplayName,
  setGmToken,
  setLastGame,
} from "../services/identity";
import "./Join.css";

const JOIN_CODE_LENGTH = 6;
const MAX_NAME_LENGTH = 30;
/** Show the counter only once it is nearly relevant. */
const COUNTER_VISIBLE_FROM = MAX_NAME_LENGTH - 10;

/**
 * What to say when the server refuses.
 *
 * Never blame the player, and always give them the next move. The server's own
 * messages are accurate but written for whoever is reading the logs, so the two
 * cases a player can actually act on get a friendlier line here; anything else
 * falls through to the server's wording, which beats a generic apology.
 */
function messageFor(error: ApiError): string {
  if (error.code === "NOT_FOUND") {
    return "That code didn't match a game — check with your host.";
  }
  if (error.code === "NETWORK") {
    return "Couldn't reach the quiz. Check your signal and try again.";
  }
  return error.message;
}

export function Join() {
  const navigate = useNavigate();
  const returning = lastGame();

  const [joinCode, setJoinCode] = useState(returning?.joinCode ?? "");
  const [name, setName] = useState(storedName() ?? "");
  const [error, setError] = useState<string>();
  /** Which field the error belongs to, so only that one is marked. */
  const [errorField, setErrorField] = useState<"joinCode" | "name">();
  const [busy, setBusy] = useState(false);

  const canSubmit = joinCode.trim().length > 0 && name.trim().length > 0 && !busy;

  async function join(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    const code = joinCode.trim().toUpperCase();
    const chosen = name.trim();
    setBusy(true);
    setError(undefined);
    setErrorField(undefined);

    try {
      const data = await execute(JoinGameMutation, {
        joinCode: code,
        playerId: playerId(),
        displayName: chosen,
      });
      setDisplayName(chosen);
      setLastGame({ gameId: data.joinGame.gameId, joinCode: code, displayName: chosen });
      navigate(`/game/${data.joinGame.gameId}/lobby`);
    } catch (cause) {
      const failure =
        cause instanceof ApiError ? cause : new ApiError(String(cause), "UNKNOWN");
      setError(messageFor(failure));
      // A taken name and a bad code are both CONFLICT-ish to the server but
      // very different to the player: mark the field they can actually fix.
      setErrorField(failure.code === "CONFLICT" ? "name" : "joinCode");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Start a game as its host.
   *
   *  hands back the GM token exactly once and the server keeps only
   * a hash of it, so it is written to storage before anything else can go wrong
   * — including before navigating. The dashboard says so out loud on arrival.
   */
  async function host(): Promise<void> {
    setBusy(true);
    setError(undefined);
    setErrorField(undefined);
    try {
      const data = await execute(CreateGameMutation);
      const created = data.createGame;
      setGmToken(created.game.id, created.gmToken);
      navigate(`/game/${created.game.id}/gm`, { state: { justCreated: true } });
    } catch (cause) {
      const failure =
        cause instanceof ApiError ? cause : new ApiError(String(cause), "UNKNOWN");
      setError(messageFor(failure));
      setErrorField("joinCode");
    } finally {
      setBusy(false);
    }
  }

  const counterVisible = name.length >= COUNTER_VISIBLE_FROM;

  return (
    <main className="kio-page kio-join">
      <Logo size={256} variant="hero" />
      <p className="kio-join__tagline">Pub quiz night, on your phone.</p>

      {returning && (
        <p className="kio-join__returning">
          Welcome back{returning.displayName ? `, ${returning.displayName}` : ""} — your
          code is filled in.
        </p>
      )}

      <form className="kio-join__form" onSubmit={join} noValidate>
        <div>
          <label className="kio-label" htmlFor="joinCode">
            Game code
          </label>
          <input
            id="joinCode"
            className={`kio-input kio-join__code${
              errorField === "joinCode" ? " kio-input--invalid" : ""
            }`}
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            maxLength={JOIN_CODE_LENGTH}
            placeholder="——————"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            // Letters and digits both appear in codes, so not inputMode numeric.
            enterKeyHint="next"
            aria-invalid={errorField === "joinCode"}
            aria-describedby={errorField === "joinCode" ? "joinError" : undefined}
          />
          {errorField === "joinCode" && error && (
            <p className="kio-field-error" id="joinError">
              {error}
            </p>
          )}
        </div>

        <div>
          <div className="kio-join__nameRow">
            <label className="kio-label" htmlFor="displayName">
              Your name
            </label>
            {counterVisible && (
              <span className="kio-join__counter">
                {name.length}/{MAX_NAME_LENGTH}
              </span>
            )}
          </div>
          <input
            id="displayName"
            className={`kio-input${errorField === "name" ? " kio-input--invalid" : ""}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_NAME_LENGTH}
            placeholder="e.g. Trivia Newton John"
            autoComplete="nickname"
            enterKeyHint="go"
            aria-invalid={errorField === "name"}
            aria-describedby={errorField === "name" ? "nameError" : undefined}
          />
          {errorField === "name" && error && (
            <p className="kio-field-error" id="nameError">
              {error}
            </p>
          )}
        </div>

        <button className="kio-button kio-button--primary" type="submit" disabled={!canSubmit}>
          {busy ? "Joining…" : returning ? "Rejoin the quiz" : "Join the quiz"}
        </button>
      </form>

      <p className="kio-join__footer kio-muted">Don't have a code? Ask your host.</p>

      {/* Quiet on purpose. Nearly everyone arriving here is a player; the one
          person hosting knows they are hosting. */}
      <p className="kio-join__host">
        Running the quiz tonight?{" "}
        <button className="kio-join__hostLink" type="button" onClick={host} disabled={busy}>
          Start a game
        </button>
      </p>
    </main>
  );
}
