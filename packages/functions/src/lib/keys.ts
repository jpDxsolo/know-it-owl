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
 * Secondary lookup item mapping a join code to a game id, so joinGame never
 * has to scan the table for a code.
 */
export function joinCode(code: string): TableKey {
  return { pk: `JOINCODE#${code}`, sk: "META" };
}

/** `begins_with` prefixes for the query access patterns. */
export const prefixes = {
  players(): string {
    return "PLAYER#";
  },
  teams(): string {
    return "TEAM#";
  },
  rounds(): string {
    return "ROUND#";
  },
  /** The round item plus all of its question items. */
  round(roundNumber: number): string {
    return `ROUND#${roundNumber}`;
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
} as const;
