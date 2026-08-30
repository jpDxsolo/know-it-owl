export type GameStatus =
  | "LOBBY"
  | "TEAMS_SET"
  | "ROUND_ACTIVE"
  | "GRADING"
  | "REVEAL"
  | "FINISHED";

export type QuestionType = "TEXT" | "PICTURE_10";

export type RoundStatus = "DRAFT" | "ACTIVE" | "GRADING" | "REVEALED";

export interface Game {
  id: string;
  joinCode: string;
  status: GameStatus;
  currentRound: number | null;
}

export interface Player {
  id: string;
  displayName: string;
  teamId: string | null;
}

export interface Team {
  id: string;
  name: string;
  score: number;
  /** Round number the team used its double on; null until used. */
  doubleUsedRound: number | null;
}

export interface Round {
  number: number;
  category: string;
  status: RoundStatus;
  /** Questions unveiled so far, 0 while the round is a draft. */
  releasedCount: number;
}

export interface Question {
  roundNumber: number;
  number: number;
  type: QuestionType;
  text?: string;
  imageKey?: string;
  correctAnswers: string[];
  defaultPoints: number;
}

export interface TeamResponse {
  roundNumber: number;
  questionNumber: number;
  teamId: string;
  /** 1 entry for TEXT, 10 for PICTURE_10. */
  answers: string[];
  doubled: boolean;
  graded: boolean;
  gradedPoints: number[] | null;
}
