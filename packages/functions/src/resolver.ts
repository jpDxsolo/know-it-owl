import type { AppSyncResolverEvent } from "aws-lambda";
import { createGame } from "./handlers/createGame.js";
import { joinGame } from "./handlers/joinGame.js";
import { randomizeTeams } from "./handlers/randomizeTeams.js";
import { setTeamName } from "./handlers/setTeamName.js";
import { createRound } from "./handlers/createRound.js";
import { startRound } from "./handlers/startRound.js";
import { chooseDouble } from "./handlers/chooseDouble.js";
import { submitAnswers } from "./handlers/submitAnswers.js";
import { gradeResponse } from "./handlers/gradeResponse.js";
import { endRound } from "./handlers/endRound.js";
import { getImageUploadUrl } from "./handlers/getImageUploadUrl.js";

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  createGame,
  joinGame,
  randomizeTeams,
  setTeamName,
  createRound,
  startRound,
  chooseDouble,
  submitAnswers,
  gradeResponse,
  endRound,
  getImageUploadUrl,
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
