/* eslint-disable */
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type CreateGamePayload = {
  game: Game;
  /** Secret token authorizing GM-only mutations. Shown once; keep it safe. */
  gmToken: Scalars['String']['output'];
};

export type Game = {
  currentRound?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  joinCode: Scalars['String']['output'];
  players: Array<Player>;
  /** Rounds this viewer may see. Players never see DRAFT rounds. */
  rounds: Array<Round>;
  status: GameStatus;
  teams: Array<Team>;
};

export type GameStatus =
  | 'FINISHED'
  | 'GRADING'
  | 'LOBBY'
  | 'REVEAL'
  | 'ROUND_ACTIVE'
  | 'TEAMS_SET';

/** Coarse-grained update fanned out to onGameUpdated subscribers. */
export type GameUpdate = {
  currentRound?: Maybe<Scalars['Int']['output']>;
  /** Event hint, e.g. PLAYER_JOINED, TEAMS_SET, ROUND_STARTED, ROUND_REVEALED. */
  event: Scalars['String']['output'];
  game: Game;
  gameId: Scalars['ID']['output'];
  /** The player this event is about. Only set on PLAYER_JOINED, so the joiner can read back the seat it was given. */
  player?: Maybe<Player>;
  status: GameStatus;
};

export type GradeResponseInput = {
  gameId: Scalars['ID']['input'];
  gmToken: Scalars['String']['input'];
  points: Array<Scalars['Int']['input']>;
  questionNumber: Scalars['Int']['input'];
  roundNumber: Scalars['Int']['input'];
  teamId: Scalars['ID']['input'];
};

export type Mutation = {
  chooseDouble: GameUpdate;
  createGame: CreateGamePayload;
  createRound: Round;
  endRound: GameUpdate;
  /** contentLength is signed into the URL, so the upload must be exactly that many bytes. */
  getImageUploadUrl: UploadUrlPayload;
  gradeResponse: TeamResponse;
  joinGame: GameUpdate;
  randomizeTeams: GameUpdate;
  /** Unveil the next question. Strictly sequential: questionNumber must be releasedCount + 1. */
  releaseQuestion: GameUpdate;
  setTeamName: GameUpdate;
  startRound: GameUpdate;
  submitAnswers: GameUpdate;
};


export type MutationChooseDoubleArgs = {
  gameId: Scalars['ID']['input'];
  playerId: Scalars['ID']['input'];
  roundNumber: Scalars['Int']['input'];
};


export type MutationCreateRoundArgs = {
  category: Scalars['String']['input'];
  gameId: Scalars['ID']['input'];
  gmToken: Scalars['String']['input'];
  questions: Array<QuestionInput>;
};


export type MutationEndRoundArgs = {
  gameId: Scalars['ID']['input'];
  gmToken: Scalars['String']['input'];
  roundNumber: Scalars['Int']['input'];
};


export type MutationGetImageUploadUrlArgs = {
  contentLength: Scalars['Int']['input'];
  contentType: Scalars['String']['input'];
  gameId: Scalars['ID']['input'];
  gmToken: Scalars['String']['input'];
};


export type MutationGradeResponseArgs = {
  input: GradeResponseInput;
};


export type MutationJoinGameArgs = {
  displayName: Scalars['String']['input'];
  joinCode: Scalars['String']['input'];
  playerId: Scalars['ID']['input'];
};


export type MutationRandomizeTeamsArgs = {
  gameId: Scalars['ID']['input'];
  gmToken: Scalars['String']['input'];
  teamCount: Scalars['Int']['input'];
};


export type MutationReleaseQuestionArgs = {
  gameId: Scalars['ID']['input'];
  gmToken: Scalars['String']['input'];
  questionNumber: Scalars['Int']['input'];
  roundNumber: Scalars['Int']['input'];
};


export type MutationSetTeamNameArgs = {
  gameId: Scalars['ID']['input'];
  name: Scalars['String']['input'];
  playerId: Scalars['ID']['input'];
  teamId: Scalars['ID']['input'];
};


export type MutationStartRoundArgs = {
  gameId: Scalars['ID']['input'];
  gmToken: Scalars['String']['input'];
  roundNumber: Scalars['Int']['input'];
};


export type MutationSubmitAnswersArgs = {
  input: SubmitAnswersInput;
};

export type Player = {
  displayName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  teamId?: Maybe<Scalars['ID']['output']>;
};

export type Query = {
  /** Pass the GM token to get the authoring view; without it the result is the player view. */
  game?: Maybe<Game>;
  myTeam?: Maybe<Team>;
  /** Pre-reveal this is GM-only; pass the token. After the reveal it is public and carries the answers. */
  roundResults?: Maybe<RoundResult>;
  standings: Array<Team>;
};


export type QueryGameArgs = {
  gameId: Scalars['ID']['input'];
  gmToken?: InputMaybe<Scalars['String']['input']>;
};


export type QueryMyTeamArgs = {
  gameId: Scalars['ID']['input'];
  playerId: Scalars['ID']['input'];
};


export type QueryRoundResultsArgs = {
  gameId: Scalars['ID']['input'];
  gmToken?: InputMaybe<Scalars['String']['input']>;
  roundNumber: Scalars['Int']['input'];
};


export type QueryStandingsArgs = {
  gameId: Scalars['ID']['input'];
};

export type Question = {
  /** Only populated after the round is revealed. */
  correctAnswers?: Maybe<Array<Scalars['String']['output']>>;
  defaultPoints: Scalars['Int']['output'];
  imageUrl?: Maybe<Scalars['String']['output']>;
  number: Scalars['Int']['output'];
  text?: Maybe<Scalars['String']['output']>;
  type: QuestionType;
};

export type QuestionAnswersInput = {
  answers: Array<Scalars['String']['input']>;
  questionNumber: Scalars['Int']['input'];
};

export type QuestionInput = {
  correctAnswers: Array<Scalars['String']['input']>;
  defaultPoints: Scalars['Int']['input'];
  imageKey?: InputMaybe<Scalars['String']['input']>;
  text?: InputMaybe<Scalars['String']['input']>;
  type: QuestionType;
};

export type QuestionType =
  | 'PICTURE_10'
  | 'TEXT';

export type Round = {
  category: Scalars['String']['output'];
  number: Scalars['Int']['output'];
  questions: Array<Question>;
  /** How many questions the GM has unveiled. Players never see beyond it. */
  releasedCount: Scalars['Int']['output'];
  status: RoundStatus;
};

export type RoundResult = {
  responses: Array<TeamResponse>;
  round: Round;
  standings: Array<Team>;
};

export type RoundStatus =
  | 'ACTIVE'
  | 'DRAFT'
  | 'GRADING'
  | 'REVEALED';

export type SubmitAnswersInput = {
  /** One entry per question; PICTURE_10 answers are the 10 strings for that question. */
  answers: Array<QuestionAnswersInput>;
  double?: InputMaybe<Scalars['Boolean']['input']>;
  gameId: Scalars['ID']['input'];
  playerId: Scalars['ID']['input'];
  roundNumber: Scalars['Int']['input'];
};

export type Subscription = {
  onGameUpdated?: Maybe<GameUpdate>;
};


export type SubscriptionOnGameUpdatedArgs = {
  gameId: Scalars['ID']['input'];
};

export type Team = {
  doubleUsedRound?: Maybe<Scalars['Int']['output']>;
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  players: Array<Player>;
  score: Scalars['Int']['output'];
};

export type TeamResponse = {
  answers: Array<Scalars['String']['output']>;
  doubled: Scalars['Boolean']['output'];
  graded: Scalars['Boolean']['output'];
  gradedPoints?: Maybe<Array<Scalars['Int']['output']>>;
  questionNumber: Scalars['Int']['output'];
  roundNumber: Scalars['Int']['output'];
  teamId: Scalars['ID']['output'];
};

export type UploadUrlPayload = {
  imageKey: Scalars['String']['output'];
  uploadUrl: Scalars['String']['output'];
};

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, unknown> | undefined;

  constructor(value: string, __meta__?: Record<string, unknown> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}
