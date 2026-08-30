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

/**
 * Stored shapes, exactly as written to the single table. Handlers use these when
 * building items to write; the mappers below re-validate on the way back out,
 * because what DynamoDB returns is only ever `unknown` in practice.
 */
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

const GAME_STATUSES: readonly GameStatus[] = [
  "LOBBY",
  "TEAMS_SET",
  "ROUND_ACTIVE",
  "GRADING",
  "REVEAL",
  "FINISHED",
];
const ROUND_STATUSES: readonly RoundStatus[] = ["DRAFT", "ACTIVE", "GRADING", "REVEALED"];
const QUESTION_TYPES: readonly QuestionType[] = ["TEXT", "PICTURE_10"];

/* ---------- attribute readers: narrow `unknown` or throw ---------- */

function invalid(item: Item, field: string, expected: string): never {
  throw new ValidationError(
    `Item ${item.pk}/${item.sk} has an invalid "${field}" (expected ${expected})`,
  );
}

function str(item: Item, field: string): string {
  const value = item[field];
  return typeof value === "string" ? value : invalid(item, field, "a string");
}

function optStr(item: Item, field: string): string | undefined {
  const value = item[field];
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : invalid(item, field, "a string");
}

function num(item: Item, field: string): number {
  const value = item[field];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : invalid(item, field, "a number");
}

function nullableNum(item: Item, field: string): number | null {
  const value = item[field];
  if (value === undefined || value === null) return null;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : invalid(item, field, "a number or null");
}

function nullableStr(item: Item, field: string): string | null {
  const value = item[field];
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : invalid(item, field, "a string or null");
}

function bool(item: Item, field: string): boolean {
  const value = item[field];
  return typeof value === "boolean" ? value : invalid(item, field, "a boolean");
}

function strList(item: Item, field: string): string[] {
  const value = item[field];
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value]
    : invalid(item, field, "an array of strings");
}

function nullableNumList(item: Item, field: string): number[] | null {
  const value = item[field];
  if (value === undefined || value === null) return null;
  return Array.isArray(value) && value.every((entry) => typeof entry === "number")
    ? [...value]
    : invalid(item, field, "an array of numbers or null");
}

function oneOf<T extends string>(item: Item, field: string, allowed: readonly T[]): T {
  const value = item[field];
  const match = allowed.find((candidate) => candidate === value);
  return match ?? invalid(item, field, `one of ${allowed.join(", ")}`);
}

/* ---------- sort-key parsing ---------- */

/** Pull the id out of a key such as `PLAYER#<id>`, failing loudly on a malformed key. */
function suffixAfter(key: string, prefix: string): string {
  if (!key.startsWith(prefix)) {
    throw new ValidationError(`Unexpected key "${key}" (expected prefix "${prefix}")`);
  }
  return key.slice(prefix.length);
}

function numberFrom(value: string, sk: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`Unexpected numeric segment in sort key "${sk}"`);
  }
  return parsed;
}

/**
 * A `ROUND#` query returns the round items and their question items together.
 * `ROUND#<n>` has no `#Q#` segment; `ROUND#<n>#Q#<qn>` does.
 */
export function isQuestionKey(sk: string): boolean {
  return sk.includes("#Q#");
}

/** `GAME#<id>` → `<id>`. */
export function gameIdFromPk(pk: string): string {
  return suffixAfter(pk, "GAME#");
}

/* ---------- item → domain type ---------- */

export function toGame(item: Item): Game {
  return {
    id: gameIdFromPk(item.pk),
    joinCode: str(item, "joinCode"),
    status: oneOf(item, "status", GAME_STATUSES),
    currentRound: nullableNum(item, "currentRound"),
  };
}

export function toPlayer(item: Item): Player {
  return {
    id: suffixAfter(item.sk, "PLAYER#"),
    displayName: str(item, "displayName"),
    teamId: nullableStr(item, "teamId"),
  };
}

export function toTeam(item: Item): Team {
  return {
    id: suffixAfter(item.sk, "TEAM#"),
    name: str(item, "name"),
    score: num(item, "score"),
    doubleUsedRound: nullableNum(item, "doubleUsedRound"),
  };
}

export function toRound(item: Item): Round {
  return {
    number: numberFrom(suffixAfter(item.sk, "ROUND#"), item.sk),
    category: str(item, "category"),
    status: oneOf(item, "status", ROUND_STATUSES),
  };
}

export function toQuestion(item: Item): Question {
  const [roundPart, questionPart] = suffixAfter(item.sk, "ROUND#").split("#Q#");
  if (questionPart === undefined) {
    throw new ValidationError(`Unexpected question sort key "${item.sk}"`);
  }
  const text = optStr(item, "text");
  const imageKey = optStr(item, "imageKey");
  return {
    roundNumber: numberFrom(roundPart, item.sk),
    number: numberFrom(questionPart, item.sk),
    type: oneOf(item, "type", QUESTION_TYPES),
    ...(text !== undefined ? { text } : {}),
    ...(imageKey !== undefined ? { imageKey } : {}),
    correctAnswers: strList(item, "correctAnswers"),
    defaultPoints: num(item, "defaultPoints"),
  };
}

export function toTeamResponse(item: Item): TeamResponse {
  const [roundPart, questionPart, teamPart] = suffixAfter(item.sk, "RESP#").split("#");
  if (roundPart === undefined || questionPart === undefined || teamPart !== "TEAM") {
    throw new ValidationError(`Unexpected response sort key "${item.sk}"`);
  }
  return {
    roundNumber: numberFrom(roundPart, item.sk),
    questionNumber: numberFrom(questionPart, item.sk),
    teamId: suffixAfter(item.sk, `RESP#${roundPart}#${questionPart}#TEAM#`),
    answers: strList(item, "answers"),
    doubled: bool(item, "doubled"),
    graded: bool(item, "graded"),
    gradedPoints: nullableNumList(item, "gradedPoints"),
  };
}

/**
 * Map every item in a query result that is of the wanted kind, ignoring the
 * rest — a game partition query returns players, teams, rounds and responses
 * together. The mapper validates each item it is handed, so no cast is needed.
 */
export function mapItems<T>(items: Item[], prefix: string, map: (item: Item) => T): T[] {
  return items.filter((item) => item.sk.startsWith(prefix)).map(map);
}
