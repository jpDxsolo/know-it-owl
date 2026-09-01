/**
 * One game, played end to end through the real handlers against an in-memory
 * table that enforces the same conditions DynamoDB would.
 *
 * This is the KIO-08 gate: the per-handler suites assert that each write is
 * shaped correctly, and this asserts that the sequence of them is a game.
 */
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chooseDouble } from "@know-it-owl/functions/handlers/chooseDouble";
import { createGame } from "@know-it-owl/functions/handlers/createGame";
import { createRound } from "@know-it-owl/functions/handlers/createRound";
import { endRound } from "@know-it-owl/functions/handlers/endRound";
import { finishGame } from "@know-it-owl/functions/handlers/finishGame";
import { getGame } from "@know-it-owl/functions/handlers/getGame";
import { gradeResponse } from "@know-it-owl/functions/handlers/gradeResponse";
import { joinGame } from "@know-it-owl/functions/handlers/joinGame";
import { myTeam } from "@know-it-owl/functions/handlers/myTeam";
import { randomizeTeams } from "@know-it-owl/functions/handlers/randomizeTeams";
import { releaseQuestion } from "@know-it-owl/functions/handlers/releaseQuestion";
import { roundResults } from "@know-it-owl/functions/handlers/roundResults";
import { standings } from "@know-it-owl/functions/handlers/standings";
import { startRound } from "@know-it-owl/functions/handlers/startRound";
import { submitAnswers } from "@know-it-owl/functions/handlers/submitAnswers";
import { setTeamName } from "@know-it-owl/functions/handlers/setTeamName";
import { setClient } from "@know-it-owl/functions/lib/db";
import * as keys from "@know-it-owl/functions/lib/keys";
import { installFakeDynamo, type FakeTable } from "./support/fakeDynamo.js";

const originalTableName = process.env.TABLE_NAME;

let table: FakeTable;

/** Everything a player was ever handed, so leakage can be checked in one go. */
let playerPayloads: unknown[];

function recordForPlayers(payload: unknown): void {
  playerPayloads.push(payload);
}

const QUESTIONS = [
  { type: "TEXT", text: "Capital of France?", correctAnswers: ["Paris"], defaultPoints: 1 },
  { type: "TEXT", text: "Capital of Norway?", correctAnswers: ["Oslo"], defaultPoints: 1 },
  { type: "TEXT", text: "Capital of Peru?", correctAnswers: ["Lima"], defaultPoints: 1 },
];

const ANSWER_KEYS = ["Paris", "Oslo", "Lima"];

beforeAll(() => {
  process.env.TABLE_NAME = "kio-table";
});

afterAll(() => {
  if (originalTableName === undefined) delete process.env.TABLE_NAME;
  else process.env.TABLE_NAME = originalTableName;
});

beforeEach(() => {
  table = installFakeDynamo();
  playerPayloads = [];
  setClient(undefined);
});

afterEach(() => setClient(undefined));

interface Setup {
  gameId: string;
  gmToken: string;
  joinCode: string;
  teamIds: string[];
  playerIds: string[];
}

/** Create a game, seat four players, and draw two teams. */
async function seatedGame(): Promise<Setup> {
  const created = await createGame();
  const { gmToken } = created;
  const gameId = created.game.id;
  const joinCode = created.game.joinCode;

  const playerIds = ["p1", "p2", "p3", "p4"];
  for (const [index, playerId] of playerIds.entries()) {
    const joined = await joinGame({ joinCode, playerId, displayName: `Player ${index + 1}` });
    recordForPlayers(joined);
  }

  const drawn = await randomizeTeams({ gameId, gmToken, teamCount: 2 });
  recordForPlayers(drawn);

  return {
    gameId,
    gmToken,
    joinCode,
    teamIds: drawn.game.teams.map((team) => team.id),
    playerIds,
  };
}

/** One player id from each team, so a submission can be made per team. */
async function captains(gameId: string, teamIds: string[]): Promise<string[]> {
  const game = await getGame({ gameId });
  return teamIds.map((teamId) => {
    const player = game?.players.find((candidate) => candidate.teamId === teamId);
    if (!player) throw new Error(`no player on team ${teamId}`);
    return player.id;
  });
}

function answersFor(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({
    questionNumber: i + 1,
    answers: [`${prefix} ${i + 1}`],
  }));
}

describe("walkthrough: lobby to reveal", () => {
  it("moves the game through the canonical status chain", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    const statuses: string[] = [];
    const readStatus = () => String(table.get(keys.gamePk(gameId), "META")?.status);

    statuses.push(readStatus()); // TEAMS_SET after the draw

    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    await startRound({ gameId, gmToken, roundNumber: 1 });
    statuses.push(readStatus());

    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 2 });
    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 3 });

    const [captainA, captainB] = await captains(gameId, teamIds);
    for (const playerId of [captainA, captainB]) {
      await submitAnswers({
        input: { gameId, playerId, roundNumber: 1, answers: answersFor(3, "guess") },
      });
    }

    await gradeResponse({
      input: { gameId, gmToken, roundNumber: 1, questionNumber: 1, teamId: teamIds[0], points: [1] },
    });
    statuses.push(readStatus());

    await endRound({ gameId, gmToken, roundNumber: 1 });
    statuses.push(readStatus());

    expect(statuses).toEqual(["TEAMS_SET", "ROUND_ACTIVE", "GRADING", "REVEAL"]);
  });

  it("starts a LOBBY game and leaves it in LOBBY until teams are drawn", async () => {
    const created = await createGame();
    expect(table.get(keys.gamePk(created.game.id), "META")?.status).toBe("LOBBY");

    await joinGame({ joinCode: created.game.joinCode, playerId: "p1", displayName: "Ada" });
    expect(table.get(keys.gamePk(created.game.id), "META")?.status).toBe("LOBBY");
  });
});

describe("walkthrough: early submission is impossible", () => {
  it("refuses answers before the round starts", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    const [captain] = await captains(gameId, teamIds);

    await expect(
      submitAnswers({
        input: { gameId, playerId: captain, roundNumber: 1, answers: answersFor(3, "guess") },
      }),
    ).rejects.toThrow(/not in play/);
  });

  it("refuses answers while questions are still unreleased", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    await startRound({ gameId, gmToken, roundNumber: 1 });
    const [captain] = await captains(gameId, teamIds);

    // Only question 1 is out.
    await expect(
      submitAnswers({
        input: { gameId, playerId: captain, roundNumber: 1, answers: answersFor(3, "guess") },
      }),
    ).rejects.toThrow(/unreleased questions \(1 of 3\)/);

    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 2 });
    await expect(
      submitAnswers({
        input: { gameId, playerId: captain, roundNumber: 1, answers: answersFor(3, "guess") },
      }),
    ).rejects.toThrow(/unreleased questions \(2 of 3\)/);

    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 3 });
    await expect(
      submitAnswers({
        input: { gameId, playerId: captain, roundNumber: 1, answers: answersFor(3, "guess") },
      }),
    ).resolves.toBeDefined();
  });

  it("accepts one submission per team and refuses the second", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    await startRound({ gameId, gmToken, roundNumber: 1 });
    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 2 });
    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 3 });

    const game = await getGame({ gameId });
    const teammates = game?.players.filter((player) => player.teamId === teamIds[0]) ?? [];
    expect(teammates.length).toBeGreaterThan(1);

    await submitAnswers({
      input: {
        gameId,
        playerId: teammates[0].id,
        roundNumber: 1,
        answers: answersFor(3, "first"),
      },
    });

    // A teammate on the same team, submitting seconds later.
    await expect(
      submitAnswers({
        input: {
          gameId,
          playerId: teammates[1].id,
          roundNumber: 1,
          answers: answersFor(3, "second"),
        },
      }),
    ).rejects.toThrow(/already submitted this round/);

    const stored = table.get(keys.gamePk(gameId), `RESP#1#1#TEAM#${teamIds[0]}`);
    expect(stored?.answers).toEqual(["first 1"]);
  });
});

describe("walkthrough: question release is sequential", () => {
  it("unveils one question at a time and refuses to skip", async () => {
    const { gameId, gmToken } = await seatedGame();
    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    await startRound({ gameId, gmToken, roundNumber: 1 });

    const released = async () => {
      const game = await getGame({ gameId });
      recordForPlayers(game);
      return game?.rounds[0].questions.map((question) => question.number) ?? [];
    };

    expect(await released()).toEqual([1]);

    // Jumping from 1 to 3 is refused by the condition, not by a check above it.
    await expect(
      releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 3 }),
    ).rejects.toThrow(/not next in round 1/);
    expect(await released()).toEqual([1]);

    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 2 });
    expect(await released()).toEqual([1, 2]);

    // Re-releasing the one just released is equally refused.
    await expect(
      releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 2 }),
    ).rejects.toThrow(/not next in round 1/);

    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 3 });
    expect(await released()).toEqual([1, 2, 3]);
  });

  it("shows the GM every question from the start", async () => {
    const { gameId, gmToken } = await seatedGame();
    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    await startRound({ gameId, gmToken, roundNumber: 1 });

    const asGm = await getGame({ gameId, gmToken });
    expect(asGm?.rounds[0].questions.map((question) => question.number)).toEqual([1, 2, 3]);
  });
});

describe("walkthrough: points reach the standings unmodified", () => {
  it("adds exactly what the GM entered, including for a doubled team", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    await startRound({ gameId, gmToken, roundNumber: 1 });
    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 2 });
    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 3 });

    const [captainA, captainB] = await captains(gameId, teamIds);

    // Team A doubles, then both teams hand in.
    recordForPlayers(await chooseDouble({ gameId, playerId: captainA, roundNumber: 1 }));
    for (const playerId of [captainA, captainB]) {
      recordForPlayers(
        await submitAnswers({
          input: { gameId, playerId, roundNumber: 1, answers: answersFor(3, "guess") },
        }),
      );
    }

    // The GM applies the double themselves: team A gets 2 a question, team B 1.
    const entered: Record<string, number[]> = { [teamIds[0]]: [2, 2, 2], [teamIds[1]]: [1, 1, 0] };
    for (const teamId of teamIds) {
      for (const [index, points] of entered[teamId].entries()) {
        await gradeResponse({
          input: {
            gameId,
            gmToken,
            roundNumber: 1,
            questionNumber: index + 1,
            teamId,
            points: [points],
          },
        });
      }
    }

    const revealed = await endRound({ gameId, gmToken, roundNumber: 1 });
    recordForPlayers(revealed);

    const table_ = await standings({ gameId });
    const scoreOf = (teamId: string) => table_.find((team) => team.id === teamId)?.score;

    // 2 + 2 + 2 = 6, not 12. The double was the GM's arithmetic, not the server's.
    expect(scoreOf(teamIds[0])).toBe(6);
    expect(scoreOf(teamIds[1])).toBe(2);
    expect(table_.map((team) => team.id)).toEqual([teamIds[0], teamIds[1]]);

    const doubledTeam = revealed.game.teams.find((team) => team.id === teamIds[0]);
    expect(doubledTeam?.doubleUsedRound).toBe(1);
    expect(doubledTeam?.score).toBe(6);
  });

  it("carries scores across two rounds", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    const [captainA, captainB] = await captains(gameId, teamIds);
    const oneQuestion = [QUESTIONS[0]];

    for (const roundNumber of [1, 2]) {
      await createRound({ gameId, gmToken, category: `Round ${roundNumber}`, questions: oneQuestion });
      await startRound({ gameId, gmToken, roundNumber });
      for (const playerId of [captainA, captainB]) {
        await submitAnswers({
          input: { gameId, playerId, roundNumber, answers: answersFor(1, "guess") },
        });
      }
      await gradeResponse({
        input: { gameId, gmToken, roundNumber, questionNumber: 1, teamId: teamIds[0], points: [3] },
      });
      await endRound({ gameId, gmToken, roundNumber });
    }

    const final = await standings({ gameId });
    expect(final.find((team) => team.id === teamIds[0])?.score).toBe(6);
    expect(final.find((team) => team.id === teamIds[1])?.score).toBe(0);
  });
});

describe("walkthrough: nothing leaks to a player", () => {
  it("keeps answer keys and the GM token out of every player payload", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    recordForPlayers(await getGame({ gameId }));

    await startRound({ gameId, gmToken, roundNumber: 1 });
    recordForPlayers(await getGame({ gameId }));
    recordForPlayers(await myTeam({ gameId, playerId: "p1" }));

    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 2 });
    recordForPlayers(await getGame({ gameId }));

    const serialised = JSON.stringify(playerPayloads);
    for (const answer of ANSWER_KEYS) {
      expect(serialised).not.toContain(answer);
    }
    expect(serialised).not.toContain(gmToken);
    expect(serialised).not.toContain("gmTokenHash");

    // The token hash is in storage, so the assertion above means something.
    expect(table.get(keys.gamePk(gameId), "META")?.gmTokenHash).toBeTruthy();
  });

  it("hides a draft round from players entirely", async () => {
    const { gameId, gmToken } = await seatedGame();
    await createRound({ gameId, gmToken, category: "Secret Round", questions: QUESTIONS });

    const asPlayer = await getGame({ gameId });
    expect(asPlayer?.rounds).toHaveLength(0);
    expect(JSON.stringify(asPlayer)).not.toContain("Secret Round");

    const asGm = await getGame({ gameId, gmToken });
    expect(asGm?.rounds).toHaveLength(1);
  });

  it("keeps roundResults GM-only until the reveal, then opens it with the answers", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    await startRound({ gameId, gmToken, roundNumber: 1 });
    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 2 });
    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 3 });

    const [captainA, captainB] = await captains(gameId, teamIds);
    for (const playerId of [captainA, captainB]) {
      await submitAnswers({
        input: { gameId, playerId, roundNumber: 1, answers: answersFor(3, "guess") },
      });
    }

    await expect(roundResults({ gameId, roundNumber: 1 })).rejects.toThrow(/not public/);
    const asGm = await roundResults({ gameId, roundNumber: 1, gmToken });
    expect(asGm?.round.questions[0].correctAnswers).toEqual(["Paris"]);

    await endRound({ gameId, gmToken, roundNumber: 1 });

    const public_ = await roundResults({ gameId, roundNumber: 1 });
    expect(public_?.round.questions.map((question) => question.correctAnswers)).toEqual([
      ["Paris"],
      ["Oslo"],
      ["Lima"],
    ]);
    expect(public_?.responses).toHaveLength(6);
  });
});

describe("walkthrough: every broadcast is a player view", () => {
  /**
   * Every mutation in the `onGameUpdated` @aws_subscribe list returns the very
   * object AppSync fans out to *all* subscribers, so a GM-shaped snapshot in any
   * of them would hand the answer key to the room. The handlers each pass
   * "PLAYER" to `snapshot`, and this is what holds them to it.
   */
  it("carries no answer keys, no GM token and no unreleased questions", async () => {
    const created = await createGame();
    const { gmToken } = created;
    const gameId = created.game.id;
    const joinCode = created.game.joinCode;

    const broadcasts: unknown[] = [];
    for (const [index, playerId] of ["p1", "p2", "p3", "p4"].entries()) {
      broadcasts.push(await joinGame({ joinCode, playerId, displayName: `Player ${index + 1}` }));
    }

    const drawn = await randomizeTeams({ gameId, gmToken, teamCount: 2 });
    broadcasts.push(drawn);
    const teamIds = drawn.game.teams.map((team) => team.id);
    const [captain, other] = await captains(gameId, teamIds);

    broadcasts.push(
      await setTeamName({ gameId, playerId: captain, teamId: teamIds[0], name: "Owls" }),
    );

    await createRound({ gameId, gmToken, category: "Capitals", questions: QUESTIONS });
    broadcasts.push(await startRound({ gameId, gmToken, roundNumber: 1 }));
    broadcasts.push(await chooseDouble({ gameId, playerId: captain, roundNumber: 1 }));
    broadcasts.push(
      await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 2 }),
    );

    const preReveal = JSON.stringify(broadcasts);
    for (const answer of ANSWER_KEYS) {
      expect(preReveal).not.toContain(answer);
    }
    expect(preReveal).not.toContain(gmToken);
    expect(preReveal).not.toContain("gmTokenHash");
    // Two of three released, so the third question has not been unveiled yet.
    expect(preReveal).toContain("Capital of Norway?");
    expect(preReveal).not.toContain("Capital of Peru?");

    await releaseQuestion({ gameId, gmToken, roundNumber: 1, questionNumber: 3 });
    for (const playerId of [captain, other]) {
      broadcasts.push(
        await submitAnswers({
          input: { gameId, playerId, roundNumber: 1, answers: answersFor(3, "guess") },
        }),
      );
    }

    const reveal = await endRound({ gameId, gmToken, roundNumber: 1 });
    broadcasts.push(reveal);

    // Ending the quiz fans out like everything else, and leaks no more than the
    // rest: a status change carrying the same player-shaped snapshot.
    broadcasts.push(await finishGame({ gameId, gmToken }));

    // The reveal is where the keys become public; the token never does.
    expect(JSON.stringify(broadcasts)).not.toContain(gmToken);
    expect(JSON.stringify(broadcasts)).not.toContain("gmTokenHash");
    expect(JSON.stringify(reveal)).toContain("Paris");
  });

  it("names every mutation the schema fans out", async () => {
    // The handlers above are the @aws_subscribe list in graphql/schema.graphql.
    // If a mutation is added there, it belongs in the broadcast check too.
    const schema = await readFile(
      new URL("../../../../graphql/schema.graphql", import.meta.url),
      "utf8",
    );
    const list = schema.split("@aws_subscribe")[1]?.split("]")[0] ?? "";
    expect([...list.matchAll(/"([a-zA-Z]+)"/g)].map((match) => match[1])).toEqual([
      "joinGame",
      "randomizeTeams",
      "setTeamName",
      "startRound",
      "releaseQuestion",
      "chooseDouble",
      "submitAnswers",
      "endRound",
      "finishGame",
    ]);
  });
});

describe("walkthrough: one double per game", () => {
  it("refuses a second double in a later round", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    const [captainA, captainB] = await captains(gameId, teamIds);
    const oneQuestion = [QUESTIONS[0]];

    await createRound({ gameId, gmToken, category: "One", questions: oneQuestion });
    await startRound({ gameId, gmToken, roundNumber: 1 });
    await chooseDouble({ gameId, playerId: captainA, roundNumber: 1 });
    for (const playerId of [captainA, captainB]) {
      await submitAnswers({
        input: { gameId, playerId, roundNumber: 1, answers: answersFor(1, "guess") },
      });
    }
    await endRound({ gameId, gmToken, roundNumber: 1 });

    await createRound({ gameId, gmToken, category: "Two", questions: oneQuestion });
    await startRound({ gameId, gmToken, roundNumber: 2 });

    await expect(
      chooseDouble({ gameId, playerId: captainA, roundNumber: 2 }),
    ).rejects.toThrow(/already used its double on round 1/);

    // The other team still has theirs.
    await expect(
      chooseDouble({ gameId, playerId: captainB, roundNumber: 2 }),
    ).resolves.toBeDefined();
  });

  it("refuses a double once the team has handed in", async () => {
    const { gameId, gmToken, teamIds } = await seatedGame();
    await createRound({ gameId, gmToken, category: "One", questions: [QUESTIONS[0]] });
    await startRound({ gameId, gmToken, roundNumber: 1 });

    const [captainA] = await captains(gameId, teamIds);
    await submitAnswers({
      input: { gameId, playerId: captainA, roundNumber: 1, answers: answersFor(1, "guess") },
    });

    await expect(
      chooseDouble({ gameId, playerId: captainA, roundNumber: 1 }),
    ).rejects.toThrow(/already submitted this round/);
  });
});
