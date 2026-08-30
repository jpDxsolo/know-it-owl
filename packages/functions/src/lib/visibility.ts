/**
 * The single place that decides what a viewer is allowed to see.
 *
 * Question text and answer keys are the one real secret in a quiz, and the same
 * filtering has to apply to query responses and to the real-time fan-out. Both
 * paths call in here rather than each re-deriving the rules, so the boundary can
 * only be widened in one file.
 */
import type { Question, QuestionType, Round, RoundStatus } from "@know-it-owl/core";
import { verifyGmToken } from "./gmAuth.js";

/** Who is asking. The GM sees the game as authored; everyone else sees the released subset. */
export type ViewerRole = "GM" | "PLAYER";

/**
 * A question as it may leave the API. `imageKey` and `text` are carried through
 * unchanged, but `correctAnswers` is null unless the viewer has earned the key.
 */
export interface VisibleQuestion {
  roundNumber: number;
  number: number;
  type: QuestionType;
  text?: string;
  imageKey?: string;
  defaultPoints: number;
  correctAnswers: string[] | null;
}

export interface VisibleRound extends Round {
  questions: VisibleQuestion[];
}

/**
 * `GM` only when the presented token verifies against the stored hash. This
 * never throws: the `game` query is open to players, so a missing or wrong
 * token simply means the caller gets the player view. Use `assertGm` instead
 * when the operation is GM-only.
 */
export function viewerRole(
  gmToken: string | undefined,
  storedHash: string | undefined,
): ViewerRole {
  if (!gmToken || !storedHash) return "PLAYER";
  return verifyGmToken(gmToken, storedHash) ? "GM" : "PLAYER";
}

/** A DRAFT round is the GM's workspace; players learn it exists once it starts. */
export function isRoundVisible(status: RoundStatus, role: ViewerRole): boolean {
  return role === "GM" || status !== "DRAFT";
}

/** The answer key stays with the GM until the round is revealed. */
export function isAnswerKeyVisible(status: RoundStatus, role: ViewerRole): boolean {
  return role === "GM" || status === "REVEALED";
}

/**
 * Within a started round the GM unveils questions one at a time, and players
 * never see past `releasedCount`. A REVEALED round shows everything, since its
 * answers are public by then.
 */
export function isQuestionReleased(
  round: Round,
  questionNumber: number,
  role: ViewerRole,
): boolean {
  if (role === "GM" || round.status === "REVEALED") return true;
  return questionNumber <= round.releasedCount;
}

function withKey(question: Question, includeKey: boolean): VisibleQuestion {
  const { correctAnswers, ...rest } = question;
  return { ...rest, correctAnswers: includeKey ? [...correctAnswers] : null };
}

function questionsOf(round: Round, questions: Question[]): Question[] {
  return questions.filter((question) => question.roundNumber === round.number);
}

/** Strip the answer key from a question unless this viewer may see it. */
export function visibleQuestion(
  question: Question,
  roundStatus: RoundStatus,
  role: ViewerRole,
): VisibleQuestion {
  return withKey(question, isAnswerKeyVisible(roundStatus, role));
}

/**
 * Every question in a round with no answer keys at all — the echo a GM gets
 * back from authoring. Deliberately bypasses the release gate (the GM wrote
 * these) but never the key gate, so that no pre-reveal payload anywhere in the
 * API carries a `correctAnswers` array.
 */
export function withoutAnswerKeys(round: Round, questions: Question[]): VisibleRound {
  return {
    ...round,
    questions: questionsOf(round, questions).map((question) => withKey(question, false)),
  };
}

/**
 * A round with its questions, or `undefined` when the round itself is not
 * visible — an unreleased round leaks nothing, not even its category.
 */
export function visibleRound(
  round: Round,
  questions: Question[],
  role: ViewerRole,
): VisibleRound | undefined {
  if (!isRoundVisible(round.status, role)) return undefined;
  return {
    ...round,
    questions: questionsOf(round, questions)
      .filter((question) => isQuestionReleased(round, question.number, role))
      .map((question) => visibleQuestion(question, round.status, role)),
  };
}

/** `visibleRound` across a whole game, dropping the rounds this viewer may not see. */
export function visibleRounds(
  rounds: Round[],
  questions: Question[],
  role: ViewerRole,
): VisibleRound[] {
  return rounds
    .map((round) => visibleRound(round, questions, role))
    .filter((round): round is VisibleRound => round !== undefined);
}
