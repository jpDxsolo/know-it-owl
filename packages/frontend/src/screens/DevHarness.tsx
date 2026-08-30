/**
 * A bare harness for exercising the client against a deployed stage: create a
 * game here, open `/dev` in a second tab, join with the code, and watch both
 * tabs update through `useGame`.
 *
 * It renders the plumbing, not a game — the real screens are the ones being
 * designed. Pull the network cable while it is open and the status line should
 * go offline and then live again on its own, with the state caught up.
 */
import { useState } from "react";
import {
  ApiError,
  CreateGameMutation,
  execute,
  JoinGameMutation,
  RandomizeTeamsMutation,
} from "../services/api";
import {
  displayName as storedName,
  gmToken,
  playerId,
  setDisplayName,
  setGmToken,
} from "../services/identity";
import { useGame } from "../hooks/useGame";

const STATUS_COLOUR: Record<string, string> = {
  live: "#1a7f37",
  connecting: "#9a6700",
  offline: "#cf222e",
};

export function DevHarness() {
  const [gameId, setGameId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState(storedName() ?? "Player");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

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
      setGameId(data.createGame.game.id);
      setJoinCode(data.createGame.game.joinCode);
    });

  const join = () =>
    run(async () => {
      setDisplayName(name);
      const data = await execute(JoinGameMutation, {
        joinCode: joinCode.trim().toUpperCase(),
        playerId: playerId(),
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

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1>Dev harness</h1>

      <section>
        <h2>1. Be the GM</h2>
        <button onClick={createGame} disabled={busy}>
          Create a game
        </button>
        {joinCode && (
          <p>
            Join code: <strong style={{ fontSize: "1.5em" }}>{joinCode}</strong> — open{" "}
            <code>/dev</code> in another tab and join with it.
          </p>
        )}
      </section>

      <section>
        <h2>2. Or be a player</h2>
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

      <section>
        <h2>3. Watch</h2>
        <p>
          <label>
            Game id{" "}
            <input
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              placeholder="paste to watch any game"
              size={40}
            />
          </label>{" "}
          <button onClick={refresh} disabled={!gameId}>
            Re-read
          </button>
        </p>

        <p>
          Realtime:{" "}
          <strong style={{ color: STATUS_COLOUR[realtime] }}>{realtime}</strong>
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
              {game.currentRound !== null && ` · round ${game.currentRound}`}{" "}
              {viewer === "GM" && (
                <button onClick={drawTeams} disabled={busy || game.players.length < 2}>
                  Draw 2 teams
                </button>
              )}
            </p>
            <p>
              Players ({game.players.length}):{" "}
              {game.players.map((player) => player.displayName).join(", ") || "nobody yet"}
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
                .map((round) => `#${round.number} ${round.category} ${round.status} (${round.questions.length}q)`)
                .join(" · ") || "none"}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
