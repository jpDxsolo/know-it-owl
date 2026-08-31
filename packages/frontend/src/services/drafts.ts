/**
 * A team's answers while they are still being typed.
 *
 * A round is answered over several minutes on a phone in a pub, and a phone
 * locks, rings, or reloads. Nothing is sent to the server until the team hands
 * in, so without this a dropped tab loses the round's work entirely.
 *
 * The draft is per game *and* per round: keeping one key per round means a
 * finished round cannot bleed its answers into the next one, and a stale draft
 * from last week's quiz is simply never read again.
 *
 * It is deliberately local. Two teammates on two phones keep two drafts and see
 * different text — the one who presses submit decides what is sent. Sharing a
 * draft live between devices is a different feature with a server behind it.
 */

/**
 * `kio.` like every other key this app writes, rather than the bare `draft:`
 * the ticket spelled out. localStorage is per-origin and shared with anything
 * else served from it, so an unnamespaced key is a collision waiting to happen
 * — and one key in five not matching its siblings is worse than the mismatch
 * with the ticket. Agreed in review on KIO-13.
 */
const DRAFT_PREFIX = "kio.draft.";

/** Answers for one round, keyed by question number. */
export interface RoundDraft {
  /** One string for a TEXT question, ten for a PICTURE_10. */
  answers: Record<number, string[]>;
  /** Whether this device intends to double the round. */
  double: boolean;
}

function key(gameId: string, roundNumber: number): string {
  return `${DRAFT_PREFIX}${gameId}.${roundNumber}`;
}

/**
 * As in `identity.ts`: storage can throw rather than merely return null, and a
 * player without it should still be able to play — they just lose the safety
 * net. So every read degrades to "no draft" and every write to a no-op.
 */
function read(name: string): string | null {
  try {
    return globalThis.localStorage?.getItem(name) ?? null;
  } catch {
    return null;
  }
}

function write(name: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(name, value);
  } catch {
    // Storage is unavailable or full. The draft lives for this page only.
  }
}

/** Keep only what this module wrote: anything else is someone else's data. */
function parseAnswers(value: unknown): Record<number, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const answers: Record<number, string[]> = {};
  for (const [questionNumber, entry] of Object.entries(value as Record<string, unknown>)) {
    const number = Number(questionNumber);
    if (!Number.isInteger(number)) continue;
    if (!Array.isArray(entry) || !entry.every((answer) => typeof answer === "string")) continue;
    answers[number] = [...(entry as string[])];
  }
  return answers;
}

/** The draft for one round, or null when there is nothing worth restoring. */
export function roundDraft(gameId: string, roundNumber: number): RoundDraft | null {
  const raw = read(key(gameId, roundNumber));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { answers, double } = parsed as Record<string, unknown>;
    return { answers: parseAnswers(answers), double: double === true };
  } catch {
    // Something else wrote this key, or it was truncated mid-write.
    return null;
  }
}

export function saveRoundDraft(gameId: string, roundNumber: number, draft: RoundDraft): void {
  write(key(gameId, roundNumber), JSON.stringify(draft));
}

/**
 * Forget a round's draft once it has been handed in.
 *
 * The answers are the server's now, and leaving them behind would restore a
 * locked round's text on the next visit as though it were still editable.
 */
export function clearRoundDraft(gameId: string, roundNumber: number): void {
  try {
    globalThis.localStorage?.removeItem(key(gameId, roundNumber));
  } catch {
    // As above.
  }
}
