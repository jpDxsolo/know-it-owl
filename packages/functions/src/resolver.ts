import type { AppSyncResolverEvent } from "aws-lambda";
import { createGame } from "./handlers/createGame.js";
import { joinGame } from "./handlers/joinGame.js";
import { randomizeTeams } from "./handlers/randomizeTeams.js";
import { setTeamName } from "./handlers/setTeamName.js";
import { createRound } from "./handlers/createRound.js";
import { startRound } from "./handlers/startRound.js";
import { releaseQuestion } from "./handlers/releaseQuestion.js";
import { chooseDouble } from "./handlers/chooseDouble.js";
import { submitAnswers } from "./handlers/submitAnswers.js";
import { gradeResponse } from "./handlers/gradeResponse.js";
import { endRound } from "./handlers/endRound.js";
import { finishGame } from "./handlers/finishGame.js";
import { getImageUploadUrl } from "./handlers/getImageUploadUrl.js";
import { getGame } from "./handlers/getGame.js";
import { myTeam } from "./handlers/myTeam.js";
import { roundResults } from "./handlers/roundResults.js";
import { standings } from "./handlers/standings.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * One entry per field in `graphql/schema.graphql`, because sst.config.ts points
 * every mutation and query resolver at this single Lambda. The keys are schema
 * field names, not handler names — `Query.game` is served by `getGame`.
 */
const handlers: Record<string, Handler> = {
  // Mutation
  createGame,
  joinGame,
  randomizeTeams,
  setTeamName,
  createRound,
  startRound,
  releaseQuestion,
  chooseDouble,
  submitAnswers,
  gradeResponse,
  endRound,
  finishGame,
  getImageUploadUrl,
  // Query
  game: getGame,
  myTeam,
  roundResults,
  standings,
};

export async function handler(
  event: AppSyncResolverEvent<Record<string, unknown>>,
): Promise<unknown> {
  const field = event.info.fieldName;
  const resolve = handlers[field];
  if (!resolve) {
    throw new Error(`No handler for field: ${field}`);
  }
  return resolve(event.arguments);
}
