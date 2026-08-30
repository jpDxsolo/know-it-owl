/**
 * Move a screen along when the game moves on.
 *
 * The lobby has no idea the host has started a round until a broadcast says so,
 * so the navigation has to be driven by game status rather than by anything the
 * player did. Two things make this fiddlier than it looks:
 *
 * - **The host and the players go different places.** A round starting sends
 *   players to answer it and the host to run it. Bouncing a host into the
 *   player round screen would strand them with no controls.
 * - **It must not fight the back button.** These are replacements, not pushes:
 *   a player who reloads mid-round and gets redirected should not have to press
 *   back twice to escape a loop between two screens.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Game, Viewer } from "./useGame";

type Status = Game["status"];

/** Where each status belongs, per viewer. `null` means "stay put". */
const DESTINATION: Record<Status, Record<Viewer, string | null>> = {
  LOBBY: { GM: null, PLAYER: null },
  TEAMS_SET: { GM: null, PLAYER: null },
  ROUND_ACTIVE: { GM: "gm", PLAYER: "round" },
  // Answers are in and the host is marking. Players wait on the round screen
  // rather than being thrown somewhere new with nothing to do.
  GRADING: { GM: "gm/grading", PLAYER: "round" },
  REVEAL: { GM: "reveal", PLAYER: "reveal" },
  FINISHED: { GM: "standings", PLAYER: "standings" },
};

/**
 * Send the viewer where this status belongs, if that is not where they already
 * are. Pass `status` as undefined while the game is still loading — nothing
 * should move before we know where we are.
 */
export function useStatusRedirect(
  gameId: string | undefined,
  status: Status | undefined,
  viewer: Viewer,
  currentScreen: string,
): void {
  const navigate = useNavigate();

  useEffect(() => {
    if (!gameId || !status) return;
    const target = DESTINATION[status][viewer];
    if (!target || target === currentScreen) return;
    navigate(`/game/${gameId}/${target}`, { replace: true });
  }, [gameId, status, viewer, currentScreen, navigate]);
}
