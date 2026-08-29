import type {
  Game,
  GameStatus,
  Player,
  Question,
  QuestionType,
  Round,
  RoundStatus,
  Team,
  TeamResponse,
} from "@know-it-owl/core";
import type { Item } from "./db.js";
import { ValidationError } from "./errors.js";

/** Stored shapes, exactly as written to the single table. */
export interface GameMetaItem extends Item {
  status: GameStatus;
  gmTokenHash: string;
  joinCode: string;
  currentRound: number | null;
  createdAt: string;
}

export interface JoinCodeItem extends Item {
  gameId: string;
}

export interface PlayerItem extends Item {
  displayName: string;
  teamId: string | null;
}

export interface TeamItem extends Item {
  name: string;
  score: number;
  doubleUsedRound: number | null;
}

export interface RoundItem extends Item {
  category: string;
  status: RoundStatus;
}

export interface QuestionItem extends Item {
  type: QuestionType;
  text?: string;
  imageKey?: string;
  correctAnswers: string[];
  defaultPoints: number;
}

export interface ResponseItem extends Item {
  answers: string[];
  doubled: boolean;
  graded: boolean;
  gradedPoints: number[] | null;
}

/** Pull the id out of a sort key such as `PLAYER#<id>`, failing loudly on a malformed key. */
function suffixAfter(sk: string, prefix: string): string {
  if (!sk.startsWith(prefix)) {
    throw new ValidationError(`Unexpected sort key "${sk}" (expected prefix "${prefix}")`);
  }
  return sk.slice(prefix.length);
}

function numberFrom(value: string, sk: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`Unexpected numeric segment in sort key "${sk}"`);
  }
  return parsed;
}

/** `GAME#<id>` → `<id>`. */
export function gameIdFromPk(pk: string): string {
  return suffixAfter(pk, "GAME#");
}

export function toGame(item: GameMetaItem): Game {
  return {
    id: gameIdFromPk(item.pk),
    joinCode: item.joinCode,
    status: item.status,
    currentRound: item.currentRound,
  };
}

export function toPlayer(item: PlayerItem): Player {
  return {
    id: suffixAfter(item.sk, "PLAYER#"),
    displayName: item.displayName,
    teamId: item.teamId,
  };
}

export function toTeam(item: TeamItem): Team {
  return {
    id: suffixAfter(item.sk, "TEAM#"),
    name: item.name,
    score: item.score,
    doubleUsedRound: item.doubleUsedRound,
  };
}

export function toRound(item: RoundItem): Round {
  return {
    number: numberFrom(suffixAfter(item.sk, "ROUND#"), item.sk),
    category: item.category,
    status: item.status,
  };
}

export function toQuestion(item: QuestionItem): Question {
  const [roundPart, questionPart] = suffixAfter(item.sk, "ROUND#").split("#Q#");
  if (questionPart === undefined) {
    throw new ValidationError(`Unexpected question sort key "${item.sk}"`);
  }
  return {
    roundNumber: numberFrom(roundPart, item.sk),
    number: numberFrom(questionPart, item.sk),
    type: item.type,
    ...(item.text !== undefined ? { text: item.text } : {}),
    ...(item.imageKey !== undefined ? { imageKey: item.imageKey } : {}),
    correctAnswers: item.correctAnswers,
    defaultPoints: item.defaultPoints,
  };
}

export function toTeamResponse(item: ResponseItem): TeamResponse {
  const [roundPart, questionPart, teamPart] = suffixAfter(item.sk, "RESP#").split("#");
  if (roundPart === undefined || questionPart === undefined || teamPart !== "TEAM") {
    throw new ValidationError(`Unexpected response sort key "${item.sk}"`);
  }
  return {
    roundNumber: numberFrom(roundPart, item.sk),
    questionNumber: numberFrom(questionPart, item.sk),
    teamId: suffixAfter(item.sk, `RESP#${roundPart}#${questionPart}#TEAM#`),
    answers: item.answers,
    doubled: item.doubled,
    graded: item.graded,
    gradedPoints: item.gradedPoints,
  };
}

/** Map every item in a query result, skipping items that are not of the wanted kind. */
export function mapItems<I extends Item, T>(
  items: Item[],
  prefix: string,
  map: (item: I) => T,
): T[] {
  return items.filter((item) => item.sk.startsWith(prefix)).map((item) => map(item as I));
}
