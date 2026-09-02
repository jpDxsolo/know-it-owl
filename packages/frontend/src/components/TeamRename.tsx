/**
 * A team naming itself.
 *
 * The server has always allowed this — `setTeamName` fans out as
 * `TEAM_RENAMED`, and lets any member of a team rename it, on the grounds that
 * there is no per-player secret in this game and membership is the only
 * authorization there is. Nothing ever called it, so teams were stuck as
 * "Team 2" for the whole quiz.
 *
 * It appears in both places a team sees its own name — the lobby, where the
 * teams have just been drawn, and the round screen's context panel, because a
 * team that did not think of a name before the first question should not have
 * missed their chance.
 *
 * There is no confirmation and no undo. Renaming is cheap, reversible by
 * renaming again, and fans out to everyone, which is its own feedback.
 */
import { useState } from "react";
import { ApiError, execute, SetTeamNameMutation } from "../services/api";
import { playerId } from "../services/identity";
import "./TeamRename.css";

/** Matches `MAX_TEAM_NAME_LENGTH` in the handler, so the field cannot outrun it. */
const MAX_TEAM_NAME_LENGTH = 30;

export interface TeamRenameProps {
  gameId: string;
  teamId: string;
  /** The current name, which is what the field opens on. */
  name: string;
}

export function TeamRename({ gameId, teamId, name }: TeamRenameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const open = (): void => {
    setDraft(name);
    setProblem(undefined);
    setEditing(true);
  };

  async function save(): Promise<void> {
    const wanted = draft.trim();
    // Nothing to send: an empty field is a slip, and the same name is a no-op
    // that would still broadcast to everyone.
    if (!wanted || wanted === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      await execute(SetTeamNameMutation, {
        gameId,
        playerId: playerId(),
        teamId,
        name: wanted,
      });
      setEditing(false);
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button className="kio-button kio-button--ghost" type="button" onClick={open}>
        Rename
      </button>
    );
  }

  return (
    <form
      className="kio-rename"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="kio-sr-only" htmlFor={`team-name-${teamId}`}>
        Team name
      </label>
      <input
        id={`team-name-${teamId}`}
        className="kio-input kio-rename__field"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={MAX_TEAM_NAME_LENGTH}
        // The team is looking at the field the moment it opens.
        autoFocus
        disabled={busy}
      />
      <div className="kio-rename__actions">
        <button className="kio-button kio-button--ghost" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          className="kio-button kio-button--ghost"
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
      {problem && <p className="kio-field-error">{problem}</p>}
    </form>
  );
}
