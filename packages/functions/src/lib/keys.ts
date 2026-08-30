/**
 * Single-table key builders. Every sort-key format in the PLAN.md data model has
 * exactly one builder here — handler code must never construct key strings inline.
 */

export interface TableKey {
  pk: string;
  sk: string;
}

/** Partition key for everything belonging to one game. */
export function gamePk(gameId: string): string {
  return `GAME#${gameId}`;
}

export function gameMeta(gameId: string): TableKey {
  return { pk: gamePk(gameId), sk: "META" };
}

export function player(gameId: string, playerId: string): TableKey {
  return { pk: gamePk(gameId), sk: `PLAYER#${playerId}` };
}

export function team(gameId: string, teamId: string): TableKey {
  return { pk: gamePk(gameId), sk: `TEAM#${teamId}` };
}

export function round(gameId: string, roundNumber: number): TableKey {
  return { pk: gamePk(gameId), sk: `ROUND#${roundNumber}` };
}

export function question(gameId: string, roundNumber: number, questionNumber: number): TableKey {
  return { pk: gamePk(gameId), sk: `ROUND#${roundNumber}#Q#${questionNumber}` };
}

export function response(
  gameId: string,
  roundNumber: number,
  questionNumber: number,
  teamId: string,
): TableKey {
  return {
    pk: gamePk(gameId),
    sk: `RESP#${roundNumber}#${questionNumber}#TEAM#${teamId}`,
  };
}

/**
 * Marks that a team has submitted its answers for a round. Written in the same
 * transaction as the answers under `attribute_not_exists`, so it is what makes
 * "one submission per team per round" a storage guarantee rather than a check.
 *
 * It shares the `RESP#<round>#` prefix so one query returns a round's answers
 * and the teams that have finished, but the `SUBMIT` segment sits where a
 * question number sits in a response key — use `isSubmissionKey` before mapping.
 */
export function submission(gameId: string, roundNumber: number, teamId: string): TableKey {
  return { pk: gamePk(gameId), sk: `RESP#${roundNumber}#SUBMIT#TEAM#${teamId}` };
}

/**
 * Secondary lookup item mapping a join code to a game id, so joinGame never
 * has to scan the table for a code.
 */
export function joinCode(code: string): TableKey {
  return { pk: `JOINCODE#${code}`, sk: "META" };
}

/**
 * `begins_with` prefixes for the query access patterns.
 *
 * Every prefix here ends at a `#` separator. That matters: round and question
 * numbers are not zero-padded, so a prefix of `ROUND#1` would also match
 * `ROUND#10`. Use `ranges.roundWithQuestions()` when a query needs the round
 * item and its questions together.
 */
export const prefixes = {
  players(): string {
    return "PLAYER#";
  },
  teams(): string {
    return "TEAM#";
  },
  /** Every round item AND every question item in the game. */
  rounds(): string {
    return "ROUND#";
  },
  questions(roundNumber: number): string {
    return `ROUND#${roundNumber}#Q#`;
  },
  responses(roundNumber: number): string {
    return `RESP#${roundNumber}#`;
  },
  questionResponses(roundNumber: number, questionNumber: number): string {
    return `RESP#${roundNumber}#${questionNumber}#TEAM#`;
  },
  /** The teams that have submitted for a round. */
  submissions(roundNumber: number): string {
    return `RESP#${roundNumber}#SUBMIT#TEAM#`;
  },
} as const;

/** An inclusive sort-key range for a `BETWEEN` key condition. */
export interface SkRange {
  start: string;
  end: string;
}

/**
 * Sort-key ranges for the access patterns that a prefix cannot express safely.
 */
export const ranges = {
  /**
   * The `ROUND#<n>` item plus its `ROUND#<n>#Q#<qn>` questions, and nothing
   * else. `#` (0x23) sorts below every digit, so this range stops before
   * `ROUND#<n>0` — i.e. round 1 does not pick up round 10.
   */
  roundWithQuestions(roundNumber: number): SkRange {
    return {
      start: `ROUND#${roundNumber}`,
      end: `ROUND#${roundNumber}#Q#\uffff`,
    };
  },
} as const;
