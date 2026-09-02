/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  fragment GameFields on Game {\n    id\n    joinCode\n    status\n    currentRound\n    players { id displayName teamId }\n    teams { id name score doubleUsedRound lastSubmittedRound players { id displayName teamId } }\n    rounds {\n      number\n      category\n      status\n      releasedCount\n      questionCount\n      doublingAllowed\n      questions { number type text imageUrl imageKey defaultPoints correctAnswers }\n    }\n  }\n": typeof types.GameFieldsFragmentDoc,
    "\n  fragment GameUpdateFields on GameUpdate {\n    gameId\n    status\n    currentRound\n    event\n    player { id displayName teamId }\n    game { ...GameFields }\n  }\n": typeof types.GameUpdateFieldsFragmentDoc,
    "\n  query Game($gameId: ID!, $gmToken: String) {\n    game(gameId: $gameId, gmToken: $gmToken) { ...GameFields }\n  }\n": typeof types.GameDocument,
    "\n  query MyTeam($gameId: ID!, $playerId: ID!) {\n    myTeam(gameId: $gameId, playerId: $playerId) {\n      id name score doubleUsedRound lastSubmittedRound players { id displayName teamId }\n    }\n  }\n": typeof types.MyTeamDocument,
    "\n  query RoundResults($gameId: ID!, $roundNumber: Int!, $gmToken: String) {\n    roundResults(gameId: $gameId, roundNumber: $roundNumber, gmToken: $gmToken) {\n      round {\n        number category status releasedCount questionCount doublingAllowed\n        questions { number type text imageUrl imageKey defaultPoints correctAnswers }\n      }\n      responses {\n        roundNumber questionNumber teamId answers doubled graded gradedPoints\n      }\n      standings { id name score doubleUsedRound lastSubmittedRound players { id displayName teamId } }\n    }\n  }\n": typeof types.RoundResultsDocument,
    "\n  query Standings($gameId: ID!) {\n    standings(gameId: $gameId) {\n      id name score doubleUsedRound lastSubmittedRound players { id displayName teamId }\n    }\n  }\n": typeof types.StandingsDocument,
    "\n  mutation CreateGame {\n    createGame { gmToken game { ...GameFields } }\n  }\n": typeof types.CreateGameDocument,
    "\n  mutation CreateRound($gameId: ID!, $gmToken: String!, $category: String!, $questions: [QuestionInput!]!, $doublingAllowed: Boolean) {\n    createRound(gameId: $gameId, gmToken: $gmToken, category: $category, questions: $questions, doublingAllowed: $doublingAllowed) {\n      number category status releasedCount questionCount doublingAllowed\n      questions { number type text imageUrl imageKey defaultPoints correctAnswers }\n    }\n  }\n": typeof types.CreateRoundDocument,
    "\n  mutation GradeResponse($input: GradeResponseInput!) {\n    gradeResponse(input: $input) {\n      roundNumber questionNumber teamId answers doubled graded gradedPoints\n    }\n  }\n": typeof types.GradeResponseDocument,
    "\n  mutation GetImageUploadUrl($gameId: ID!, $gmToken: String!, $contentType: String!, $contentLength: Int!) {\n    getImageUploadUrl(gameId: $gameId, gmToken: $gmToken, contentType: $contentType, contentLength: $contentLength) {\n      uploadUrl\n      imageKey\n    }\n  }\n": typeof types.GetImageUploadUrlDocument,
    "\n  mutation JoinGame($joinCode: String!, $playerId: ID!, $displayName: String!) {\n    joinGame(joinCode: $joinCode, playerId: $playerId, displayName: $displayName) { ...GameUpdateFields }\n  }\n": typeof types.JoinGameDocument,
    "\n  mutation RandomizeTeams($gameId: ID!, $gmToken: String!, $teamCount: Int!) {\n    randomizeTeams(gameId: $gameId, gmToken: $gmToken, teamCount: $teamCount) { ...GameUpdateFields }\n  }\n": typeof types.RandomizeTeamsDocument,
    "\n  mutation SetTeamName($gameId: ID!, $playerId: ID!, $teamId: ID!, $name: String!) {\n    setTeamName(gameId: $gameId, playerId: $playerId, teamId: $teamId, name: $name) { ...GameUpdateFields }\n  }\n": typeof types.SetTeamNameDocument,
    "\n  mutation StartRound($gameId: ID!, $gmToken: String!, $roundNumber: Int!) {\n    startRound(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber) { ...GameUpdateFields }\n  }\n": typeof types.StartRoundDocument,
    "\n  mutation ReleaseQuestion($gameId: ID!, $gmToken: String!, $roundNumber: Int!, $questionNumber: Int!) {\n    releaseQuestion(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber, questionNumber: $questionNumber) { ...GameUpdateFields }\n  }\n": typeof types.ReleaseQuestionDocument,
    "\n  mutation ChooseDouble($gameId: ID!, $playerId: ID!, $roundNumber: Int!) {\n    chooseDouble(gameId: $gameId, playerId: $playerId, roundNumber: $roundNumber) { ...GameUpdateFields }\n  }\n": typeof types.ChooseDoubleDocument,
    "\n  mutation SubmitAnswers($input: SubmitAnswersInput!) {\n    submitAnswers(input: $input) { ...GameUpdateFields }\n  }\n": typeof types.SubmitAnswersDocument,
    "\n  mutation FinishGame($gameId: ID!, $gmToken: String!) {\n    finishGame(gameId: $gameId, gmToken: $gmToken) { ...GameUpdateFields }\n  }\n": typeof types.FinishGameDocument,
    "\n  mutation EndRound($gameId: ID!, $gmToken: String!, $roundNumber: Int!) {\n    endRound(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber) { ...GameUpdateFields }\n  }\n": typeof types.EndRoundDocument,
    "\n  subscription OnGameUpdated($gameId: ID!) {\n    onGameUpdated(gameId: $gameId) { ...GameUpdateFields }\n  }\n": typeof types.OnGameUpdatedDocument,
};
const documents: Documents = {
    "\n  fragment GameFields on Game {\n    id\n    joinCode\n    status\n    currentRound\n    players { id displayName teamId }\n    teams { id name score doubleUsedRound lastSubmittedRound players { id displayName teamId } }\n    rounds {\n      number\n      category\n      status\n      releasedCount\n      questionCount\n      doublingAllowed\n      questions { number type text imageUrl imageKey defaultPoints correctAnswers }\n    }\n  }\n": types.GameFieldsFragmentDoc,
    "\n  fragment GameUpdateFields on GameUpdate {\n    gameId\n    status\n    currentRound\n    event\n    player { id displayName teamId }\n    game { ...GameFields }\n  }\n": types.GameUpdateFieldsFragmentDoc,
    "\n  query Game($gameId: ID!, $gmToken: String) {\n    game(gameId: $gameId, gmToken: $gmToken) { ...GameFields }\n  }\n": types.GameDocument,
    "\n  query MyTeam($gameId: ID!, $playerId: ID!) {\n    myTeam(gameId: $gameId, playerId: $playerId) {\n      id name score doubleUsedRound lastSubmittedRound players { id displayName teamId }\n    }\n  }\n": types.MyTeamDocument,
    "\n  query RoundResults($gameId: ID!, $roundNumber: Int!, $gmToken: String) {\n    roundResults(gameId: $gameId, roundNumber: $roundNumber, gmToken: $gmToken) {\n      round {\n        number category status releasedCount questionCount doublingAllowed\n        questions { number type text imageUrl imageKey defaultPoints correctAnswers }\n      }\n      responses {\n        roundNumber questionNumber teamId answers doubled graded gradedPoints\n      }\n      standings { id name score doubleUsedRound lastSubmittedRound players { id displayName teamId } }\n    }\n  }\n": types.RoundResultsDocument,
    "\n  query Standings($gameId: ID!) {\n    standings(gameId: $gameId) {\n      id name score doubleUsedRound lastSubmittedRound players { id displayName teamId }\n    }\n  }\n": types.StandingsDocument,
    "\n  mutation CreateGame {\n    createGame { gmToken game { ...GameFields } }\n  }\n": types.CreateGameDocument,
    "\n  mutation CreateRound($gameId: ID!, $gmToken: String!, $category: String!, $questions: [QuestionInput!]!, $doublingAllowed: Boolean) {\n    createRound(gameId: $gameId, gmToken: $gmToken, category: $category, questions: $questions, doublingAllowed: $doublingAllowed) {\n      number category status releasedCount questionCount doublingAllowed\n      questions { number type text imageUrl imageKey defaultPoints correctAnswers }\n    }\n  }\n": types.CreateRoundDocument,
    "\n  mutation GradeResponse($input: GradeResponseInput!) {\n    gradeResponse(input: $input) {\n      roundNumber questionNumber teamId answers doubled graded gradedPoints\n    }\n  }\n": types.GradeResponseDocument,
    "\n  mutation GetImageUploadUrl($gameId: ID!, $gmToken: String!, $contentType: String!, $contentLength: Int!) {\n    getImageUploadUrl(gameId: $gameId, gmToken: $gmToken, contentType: $contentType, contentLength: $contentLength) {\n      uploadUrl\n      imageKey\n    }\n  }\n": types.GetImageUploadUrlDocument,
    "\n  mutation JoinGame($joinCode: String!, $playerId: ID!, $displayName: String!) {\n    joinGame(joinCode: $joinCode, playerId: $playerId, displayName: $displayName) { ...GameUpdateFields }\n  }\n": types.JoinGameDocument,
    "\n  mutation RandomizeTeams($gameId: ID!, $gmToken: String!, $teamCount: Int!) {\n    randomizeTeams(gameId: $gameId, gmToken: $gmToken, teamCount: $teamCount) { ...GameUpdateFields }\n  }\n": types.RandomizeTeamsDocument,
    "\n  mutation SetTeamName($gameId: ID!, $playerId: ID!, $teamId: ID!, $name: String!) {\n    setTeamName(gameId: $gameId, playerId: $playerId, teamId: $teamId, name: $name) { ...GameUpdateFields }\n  }\n": types.SetTeamNameDocument,
    "\n  mutation StartRound($gameId: ID!, $gmToken: String!, $roundNumber: Int!) {\n    startRound(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber) { ...GameUpdateFields }\n  }\n": types.StartRoundDocument,
    "\n  mutation ReleaseQuestion($gameId: ID!, $gmToken: String!, $roundNumber: Int!, $questionNumber: Int!) {\n    releaseQuestion(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber, questionNumber: $questionNumber) { ...GameUpdateFields }\n  }\n": types.ReleaseQuestionDocument,
    "\n  mutation ChooseDouble($gameId: ID!, $playerId: ID!, $roundNumber: Int!) {\n    chooseDouble(gameId: $gameId, playerId: $playerId, roundNumber: $roundNumber) { ...GameUpdateFields }\n  }\n": types.ChooseDoubleDocument,
    "\n  mutation SubmitAnswers($input: SubmitAnswersInput!) {\n    submitAnswers(input: $input) { ...GameUpdateFields }\n  }\n": types.SubmitAnswersDocument,
    "\n  mutation FinishGame($gameId: ID!, $gmToken: String!) {\n    finishGame(gameId: $gameId, gmToken: $gmToken) { ...GameUpdateFields }\n  }\n": types.FinishGameDocument,
    "\n  mutation EndRound($gameId: ID!, $gmToken: String!, $roundNumber: Int!) {\n    endRound(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber) { ...GameUpdateFields }\n  }\n": types.EndRoundDocument,
    "\n  subscription OnGameUpdated($gameId: ID!) {\n    onGameUpdated(gameId: $gameId) { ...GameUpdateFields }\n  }\n": types.OnGameUpdatedDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment GameFields on Game {\n    id\n    joinCode\n    status\n    currentRound\n    players { id displayName teamId }\n    teams { id name score doubleUsedRound lastSubmittedRound players { id displayName teamId } }\n    rounds {\n      number\n      category\n      status\n      releasedCount\n      questionCount\n      doublingAllowed\n      questions { number type text imageUrl imageKey defaultPoints correctAnswers }\n    }\n  }\n"): typeof import('./graphql').GameFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment GameUpdateFields on GameUpdate {\n    gameId\n    status\n    currentRound\n    event\n    player { id displayName teamId }\n    game { ...GameFields }\n  }\n"): typeof import('./graphql').GameUpdateFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Game($gameId: ID!, $gmToken: String) {\n    game(gameId: $gameId, gmToken: $gmToken) { ...GameFields }\n  }\n"): typeof import('./graphql').GameDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyTeam($gameId: ID!, $playerId: ID!) {\n    myTeam(gameId: $gameId, playerId: $playerId) {\n      id name score doubleUsedRound lastSubmittedRound players { id displayName teamId }\n    }\n  }\n"): typeof import('./graphql').MyTeamDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query RoundResults($gameId: ID!, $roundNumber: Int!, $gmToken: String) {\n    roundResults(gameId: $gameId, roundNumber: $roundNumber, gmToken: $gmToken) {\n      round {\n        number category status releasedCount questionCount doublingAllowed\n        questions { number type text imageUrl imageKey defaultPoints correctAnswers }\n      }\n      responses {\n        roundNumber questionNumber teamId answers doubled graded gradedPoints\n      }\n      standings { id name score doubleUsedRound lastSubmittedRound players { id displayName teamId } }\n    }\n  }\n"): typeof import('./graphql').RoundResultsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Standings($gameId: ID!) {\n    standings(gameId: $gameId) {\n      id name score doubleUsedRound lastSubmittedRound players { id displayName teamId }\n    }\n  }\n"): typeof import('./graphql').StandingsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateGame {\n    createGame { gmToken game { ...GameFields } }\n  }\n"): typeof import('./graphql').CreateGameDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateRound($gameId: ID!, $gmToken: String!, $category: String!, $questions: [QuestionInput!]!, $doublingAllowed: Boolean) {\n    createRound(gameId: $gameId, gmToken: $gmToken, category: $category, questions: $questions, doublingAllowed: $doublingAllowed) {\n      number category status releasedCount questionCount doublingAllowed\n      questions { number type text imageUrl imageKey defaultPoints correctAnswers }\n    }\n  }\n"): typeof import('./graphql').CreateRoundDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GradeResponse($input: GradeResponseInput!) {\n    gradeResponse(input: $input) {\n      roundNumber questionNumber teamId answers doubled graded gradedPoints\n    }\n  }\n"): typeof import('./graphql').GradeResponseDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation GetImageUploadUrl($gameId: ID!, $gmToken: String!, $contentType: String!, $contentLength: Int!) {\n    getImageUploadUrl(gameId: $gameId, gmToken: $gmToken, contentType: $contentType, contentLength: $contentLength) {\n      uploadUrl\n      imageKey\n    }\n  }\n"): typeof import('./graphql').GetImageUploadUrlDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation JoinGame($joinCode: String!, $playerId: ID!, $displayName: String!) {\n    joinGame(joinCode: $joinCode, playerId: $playerId, displayName: $displayName) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').JoinGameDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RandomizeTeams($gameId: ID!, $gmToken: String!, $teamCount: Int!) {\n    randomizeTeams(gameId: $gameId, gmToken: $gmToken, teamCount: $teamCount) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').RandomizeTeamsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SetTeamName($gameId: ID!, $playerId: ID!, $teamId: ID!, $name: String!) {\n    setTeamName(gameId: $gameId, playerId: $playerId, teamId: $teamId, name: $name) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').SetTeamNameDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartRound($gameId: ID!, $gmToken: String!, $roundNumber: Int!) {\n    startRound(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').StartRoundDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ReleaseQuestion($gameId: ID!, $gmToken: String!, $roundNumber: Int!, $questionNumber: Int!) {\n    releaseQuestion(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber, questionNumber: $questionNumber) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').ReleaseQuestionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation ChooseDouble($gameId: ID!, $playerId: ID!, $roundNumber: Int!) {\n    chooseDouble(gameId: $gameId, playerId: $playerId, roundNumber: $roundNumber) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').ChooseDoubleDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SubmitAnswers($input: SubmitAnswersInput!) {\n    submitAnswers(input: $input) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').SubmitAnswersDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation FinishGame($gameId: ID!, $gmToken: String!) {\n    finishGame(gameId: $gameId, gmToken: $gmToken) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').FinishGameDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation EndRound($gameId: ID!, $gmToken: String!, $roundNumber: Int!) {\n    endRound(gameId: $gameId, gmToken: $gmToken, roundNumber: $roundNumber) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').EndRoundDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  subscription OnGameUpdated($gameId: ID!) {\n    onGameUpdated(gameId: $gameId) { ...GameUpdateFields }\n  }\n"): typeof import('./graphql').OnGameUpdatedDocument;


export function graphql(source: string) {
  return (documents as Record<string, unknown>)[source] ?? {};
}
