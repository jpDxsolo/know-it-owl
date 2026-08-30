/**
 * A bare harness for exercising the client against a deployed stage: create a
 * game here, open a second tab, join with the code, and watch both tabs update
 * through `useGame`.
 *
 * It renders the plumbing, not a game — the real screens are the ones being
 * designed. Pull the network cable while it is open and the status line should
 * go offline and then live again on its own, with the state caught up.
 *
 * Two things it has to work around, both consequences of correct behaviour
 * elsewhere:
 *
 * - Identity is per *browser*, not per tab, and duplicating a tab copies
 *   localStorage. Since `joinGame` is idempotent on the player id — which is
 *   what makes a mid-game refresh rejoin the same seat — every tab would
 *   otherwise be the same player, and the second join would merely rename the
 *   first. So the harness lets a tab take its own identity.
 * - The game being watched lives in the URL, so a refresh does not lose it and
 *   a duplicated tab starts out watching the same game.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ApiError,
  CreateGameMutation,
  execute,
  JoinGameMutation,
  RandomizeTeamsMutation,
} from "../services/api";
import {
  displayName as storedName,
  gmGameIds,
  gmToken,
  playerId as storedPlayerId,
  setDisplayName,
  setGmToken,
} from "../services/identity";
import { useGame } from "../hooks/useGame";

const STATUS_COLOUR: Record<string, string> = {
  live: "#1a7f37",
  connecting: "#9a6700",
  offline: "#cf222e",
};

const box = { border: "1px solid #d0d7de", borderRadius: 8, padding: 12, marginBottom: 12 };

export function DevHarness() {
  const [params, setParams] = useSearchParams();
  const gameId = params.get("game") ?? "";

  const setGameId = (next: string): void => {
    if (next) setParams({ game: next }, { replace: true });
    else setParams({}, { replace: true });
  };

  // Defaults to this browser's real identity; a duplicated tab can take its own
  // so that two tabs are two players rather than one renamed twice.
  const [identity, setIdentity] = useState(() => storedPlayerId());
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState(storedName() ?? "Player");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [gmGames, setGmGames] = useState<string[]>([]);

  useEffect(() => setGmGames(gmGameIds()), [gameId]);

  const { game, lastEvent, realtime, loading, error, viewer, refresh } = useGame(gameId || undefined);

  async function run(what: () => Promise<void>): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      await what();
    } catch (cause) {
      setProblem(cause instanceof ApiError ? `${cause.code}: ${cause.message}` : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const createGame = () =>
    run(async () => {
      const data = await execute(CreateGameMutation);
      // Stored before anything else can fail: the server issues this once.
      setGmToken(data.createGame.game.id, data.createGame.gmToken);
      setJoinCode(data.createGame.game.joinCode);
      setGameId(data.createGame.game.id);
    });

  const join = () =>
    run(async () => {
      setDisplayName(name);
      const data = await execute(JoinGameMutation, {
        joinCode: joinCode.trim().toUpperCase(),
        playerId: identity,
        displayName: name,
      });
      setGameId(data.joinGame.gameId);
    });

  const drawTeams = () =>
    run(async () => {
      const token = gmToken(gameId);
      if (!token) throw new Error("This browser is not the GM of that game");
      await execute(RandomizeTeamsMutation, { gameId, gmToken: token, teamCount: 2 });
    });

  const isThisTabsPlayer = game?.players.some((player) => player.id === identity) ?? false;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <h1>Dev harness</h1>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>This tab</h2>
        <p style={{ margin: "4px 0" }}>
          <label>
            Player id{" "}
            <input value={identity} onChange={(e) => setIdentity(e.target.value)} size={40} />
          </label>{" "}
          <button onClick={() => setIdentity(crypto.randomUUID())}>New identity</button>
        </p>
        <p style={{ margin: "4px 0", color: "#57606a", fontSize: "0.9em" }}>
          Duplicating a tab copies localStorage, so every tab starts as the same player — and
          joining twice with one id renames that player rather than adding a second. Hit{" "}
          <em>New identity</em> in each extra tab to be a different person.
          {identity !== storedPlayerId() && " This tab is using a throwaway id."}
        </p>
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Be the GM</h2>
        <button onClick={createGame} disabled={busy}>
          Create a game
        </button>
        {joinCode && (
          <p>
            Join code: <strong style={{ fontSize: "1.5em" }}>{joinCode}</strong>
          </p>
        )}
        {gmGames.length > 0 && (
          <p style={{ fontSize: "0.9em" }}>
            This browser holds GM tokens for:{" "}
            {gmGames.map((id) => (
              <button
                key={id}
                onClick={() => setGameId(id)}
                style={{ marginRight: 6, fontFamily: "monospace", fontSize: "0.9em" }}
              >
                {id.slice(0, 8)}…
              </button>
            ))}
          </p>
        )}
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Or be a player</h2>
        <label>
          Join code{" "}
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="ABC123" />
        </label>{" "}
        <label>
          Name <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>{" "}
        <button onClick={join} disabled={busy || !joinCode.trim()}>
          Join
        </button>
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Watch</h2>
        <p>
          <label>
            Game id{" "}
            <input
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              placeholder="paste a game id, or create/join above"
              size={40}
            />
          </label>{" "}
          <button onClick={refresh} disabled={!gameId}>
            Re-read
          </button>
        </p>

        <p>
          Realtime: <strong style={{ color: STATUS_COLOUR[realtime] }}>{realtime}</strong>
          {" · "}viewer: <strong>{viewer}</strong>
          {loading && " · loading"}
          {lastEvent && (
            <>
              {" · last event: "}
              <strong>{lastEvent.event}</strong>
            </>
          )}
        </p>

        {problem && <p style={{ color: "#cf222e" }}>{problem}</p>}
        {error && (
          <p style={{ color: "#cf222e" }}>
            {error.code}: {error.message}
          </p>
        )}

        {game && (
          <>
            <p>
              <strong>{game.joinCode}</strong> · {game.status}
              {game.currentRound !== null && ` · round ${game.currentRound}`}
            </p>
            <p>
              Players ({game.players.length}):{" "}
              {game.players
                .map((player) => (player.id === identity ? `${player.displayName} (you)` : player.displayName))
                .join(", ") || "nobody yet"}
            </p>
            <p>
              Teams:{" "}
              {game.teams
                .map((team) => `${team.name} (${team.players.length}, ${team.score} pts)`)
                .join(" · ") || "not drawn"}
            </p>
            <p>
              Rounds visible to this viewer:{" "}
              {game.rounds
                .map(
                  (round) =>
                    `#${round.number} ${round.category} ${round.status} (${round.questions.length}q)`,
                )
                .join(" · ") || "none"}
            </p>
            {viewer === "GM" && (
              <p>
                <button onClick={drawTeams} disabled={busy || game.players.length < 2}>
                  Draw 2 teams
                </button>
                {game.players.length < 2 && (
                  <span style={{ marginLeft: 8, color: "#57606a", fontSize: "0.9em" }}>
                    Needs at least 2 players — check each tab has its own player id above.
                  </span>
                )}
              </p>
            )}
            {viewer === "PLAYER" && !isThisTabsPlayer && (
              <p style={{ color: "#57606a", fontSize: "0.9em" }}>
                Watching only — this tab has not joined, and holds no GM token for this game.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
