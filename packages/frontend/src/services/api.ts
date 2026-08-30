/**
 * Every GraphQL operation the app sends, and the one function that sends them.
 *
 * The operations are declared here rather than in the screens so that codegen
 * sees them all in one place, and — more importantly — so that every mutation
 * that fans out shares the *same* selection as the subscription. See
 * `GameUpdateFields` below for why that matters more than it looks.
 */
import { graphql } from "../gql";
import type { TypedDocumentString } from "../gql/graphql";
import { apiConfig } from "./config";

/** How a failure reaches the UI. `code` mirrors the server's error classes. */
export type ApiErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "NETWORK"
  | "UNKNOWN";

/**
 * AppSync reports a resolver failure as the *class name* the Lambda threw, not
 * the `code` the class carries — that field does not survive the boundary. So
 * the mapping is by name, and it is the reason `packages/functions/src/lib/
 * errors.ts` class names are effectively part of the API contract.
 */
const CODE_BY_ERROR_TYPE: Partial<Record<string, ApiErrorCode>> = {
  NotFoundError: "NOT_FOUND",
  ForbiddenError: "FORBIDDEN",
  ValidationError: "VALIDATION",
  ConflictError: "CONFLICT",
  UnauthorizedException: "UNAUTHORIZED",
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** The raw `errorType`, kept for logging when the code is UNKNOWN. */
  readonly errorType: string | undefined;

  constructor(message: string, code: ApiErrorCode, errorType?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.errorType = errorType;
  }

  /** True for failures that a retry might clear, as opposed to a refusal. */
  get isTransient(): boolean {
    return this.code === "NETWORK";
  }
}

interface GraphQLResponseError {
  message?: string;
  errorType?: string;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLResponseError[] | null;
}

function toApiError(error: GraphQLResponseError): ApiError {
  const errorType = error.errorType;
  const code = errorType ? CODE_BY_ERROR_TYPE[errorType] : undefined;
  return new ApiError(
    error.message ?? "The server rejected the request",
    code ?? "UNKNOWN",
    errorType,
  );
}

/**
 * Send one operation and return its data, throwing an `ApiError` for anything
 * else. Variables are typed by the document, so a missing argument is a compile
 * error rather than a runtime rejection.
 */
export async function execute<TResult, TVariables>(
  document: TypedDocumentString<TResult, TVariables>,
  variables?: TVariables,
): Promise<TResult> {
  const { url, apiKey } = apiConfig();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query: document.toString(), variables: variables ?? {} }),
    });
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? cause.message : "The network request failed",
      "NETWORK",
    );
  }

  if (!response.ok && response.status >= 500) {
    // A 5xx never carries a GraphQL body worth parsing, and is worth retrying.
    throw new ApiError(`The server returned ${response.status}`, "NETWORK");
  }

  let body: GraphQLResponse<TResult>;
  try {
    body = (await response.json()) as GraphQLResponse<TResult>;
  } catch {
    throw new ApiError(`The server returned an unreadable ${response.status} response`, "NETWORK");
  }

  // A partial success still carries errors; the first one is the useful one.
  const [first] = body.errors ?? [];
  if (first) throw toApiError(first);
  if (body.data === null || body.data === undefined) {
    throw new ApiError("The server returned no data", "UNKNOWN");
  }
  return body.data;
}

/**
 * Everything a screen renders about a game. One fragment, so the query and the
 * fan-out cannot drift apart.
 */
export const GameFields = graphql(`
  fragment GameFields on Game {
    id
    joinCode
    status
    currentRound
    players { id displayName teamId }
    teams { id name score doubleUsedRound players { id displayName teamId } }
    rounds {
      number
      category
      status
      releasedCount
      questions { number type text imageUrl defaultPoints correctAnswers }
    }
  }
`);

/**
 * The shape of every real-time event — and, deliberately, of every mutation
 * that produces one.
 *
 * AppSync delivers a subscriber *only the fields the mutation selected*, and it
 * matches the `gameId` filter against the mutation's own response. A mutation
 * that selects less than the subscription does silently delivers a half-empty
 * event; one that omits `gameId` delivers nothing at all, looking exactly like
 * a broken subscription. Spreading this one fragment in both places makes that
 * class of bug unrepresentable. See docs/manual-testing.md.
 */
export const GameUpdateFields = graphql(`
  fragment GameUpdateFields on GameUpdate {
    gameId
    status
    currentRound
    event
    player { id displayName teamId }
    game { ...GameFields }
  }
`);

// --- Queries ---

export const GameQuery = graphql(`
  query Game($gameId: ID!, $gmToken: String) {
    game(gameId: $gameId, gmToken: $gmToken) { ...GameFields }
  }
`);

export const MyTeamQuery = graphql(`
  query MyTeam($gameId: ID!, $playerId: ID!) {
    myTeam(gameId: $gameId, playerId: $playerId) {
      id name score doubleUsedRound players { id displayName teamId }
    }
  }
`);

export const RoundResultsQuery = graphql(`
  query RoundResults($gameId: ID!, $roundNumber: Int!, $gmToken: String) {
    roundResults(gameId: $gameId, roundNumber: $roundNumber, gmToken: $gmToken) {
      round {
        number category status releasedCount
        questions { number type text imageUrl defaultPoints correctAnswers }
      }
      responses {
        roundNumber questionNumber teamId answers doubled graded gradedPoints
      }
      standings { id name score doubleUsedRound players { id displayName teamId } }
    }
  }
`);

export const StandingsQuery = graphql(`
  query Standings($gameId: ID!) {
    standings(gameId: $gameId) {
      id name score doubleUsedRound players { id displayName teamId }
    }
  }
`);

// --- Mutations that do not fan out ---

export const CreateGameMutation = graphql(`
  mutation CreateGame {
    createGame { gmToken game { ...GameFields } }
  }
`);

export const CreateRoundMutation = graphql(`
  mutation CreateRound($gameId: ID!, $gmToken: String!, $category: String!, $questions: [QuestionInput!]!) {
    createRound(gameId: $gameId, gmToken: $gmToken, category: $category, questions: $questions) {
      number category status releasedCount
      questions { number type text imageUrl defaultPoints correctAnswers }
    }
  }
`);

export const GradeResponseMutation = graphql(`
  mutation GradeResponse($input: GradeResponseInput!) {
    gradeResponse(input: $input) {
      roundNumber questionNumber teamId answers doubled graded gradedPoints
    }
  }
`);

export const GetImageUploadUrlMutation = graphql(`
  mutation GetImageUploadUrl($gameId: ID!, $gmToken: String!, $contentType: String!, $contentLength: Int!) {
    getImageUploadUrl(gameId: $gameId, gmToken: $gmToken, contentType: $contentType, contentLength: $contentLength) {
      uploadUrl
      imageKey
    }
  }
`);

// --- Mutations that fan out. Every one selects GameUpdateFields, no exceptions. ---

export const JoinGameMutation = graphql(`
  mutation JoinGame($joinCode: String!, $playerId: ID!, $displayName: String!) {
    joinGame(joinCode: $joinCode, playerId: $playerId, displayName: $displayName) { ...GameUpdateFields }
  }
`);

export const RandomizeTeamsMutation = graphql(`
  mutation RandomizeTeams($gameId: ID!, $gmToken: String!, $teamCount: Int!) {
    randomizeTeams(gameId: $gameId, gmToken: $gmToken, teamCount: $teamCount) { ...GameUpdateFields }
  }
`);

export const SetTeamNameMutation = graphql(`
  mutation SetTeamName($gameId: ID!, $playerId: ID!, $teamId: ID!, $name: String!) {
    setTeamName(gameId: $gameId, playerId: $playerId, teamId: $teamId, name: $name) { ...GameUpdateFields }
  }
`);

export const StartRoundMutation = graphql(`
  mutation StartRound($gameId: ID!, $gmToken: String!, $roundNumber: Int!) {
    startRound(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber) { ...GameUpdateFields }
  }
`);

export const ReleaseQuestionMutation = graphql(`
  mutation ReleaseQuestion($gameId: ID!, $gmToken: String!, $roundNumber: Int!, $questionNumber: Int!) {
    releaseQuestion(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber, questionNumber: $questionNumber) { ...GameUpdateFields }
  }
`);

export const ChooseDoubleMutation = graphql(`
  mutation ChooseDouble($gameId: ID!, $playerId: ID!, $roundNumber: Int!) {
    chooseDouble(gameId: $gameId, playerId: $playerId, roundNumber: $roundNumber) { ...GameUpdateFields }
  }
`);

export const SubmitAnswersMutation = graphql(`
  mutation SubmitAnswers($input: SubmitAnswersInput!) {
    submitAnswers(input: $input) { ...GameUpdateFields }
  }
`);

export const EndRoundMutation = graphql(`
  mutation EndRound($gameId: ID!, $gmToken: String!, $roundNumber: Int!) {
    endRound(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber) { ...GameUpdateFields }
  }
`);

// --- Subscription. Same fragment as every mutation above. ---

export const OnGameUpdatedSubscription = graphql(`
  subscription OnGameUpdated($gameId: ID!) {
    onGameUpdated(gameId: $gameId) { ...GameUpdateFields }
  }
`);
