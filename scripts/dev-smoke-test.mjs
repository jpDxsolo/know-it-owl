#!/usr/bin/env node
/**
 * The KIO-09 smoke test: one whole game played against a deployed stage, with
 * two live subscribers watching, so the parts only a real AppSync can break —
 * subscription fan-out, presigned S3 uploads — are actually exercised.
 *
 *   API_URL=... API_KEY=... node scripts/dev-smoke-test.mjs
 *
 * Both values are printed by `npx sst deploy`. See docs/dev-smoke-test.md,
 * which also gives the equivalent walkthrough by hand in the AppSync console.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";


/** Open one onGameUpdated subscription and collect the events it receives. */
async function subscribe({ apiUrl, apiKey, gameId, label }) {
  const host = new URL(apiUrl).host;
  const realtime = apiUrl.replace("appsync-api", "appsync-realtime-api");
  const auth = { host, "x-api-key": apiKey };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
  const ws = new WebSocket(
    `${realtime.replace(/^https/, "wss")}?header=${b64(auth)}&payload=${b64({})}`,
    ["graphql-ws"],
  );
  const events = [];
  const id = randomUUID();
  const query = `subscription($gameId: ID!) {
    onGameUpdated(gameId: $gameId) {
      gameId status currentRound event
      player { id displayName teamId }
      game {
        status
        players { id displayName teamId }
        teams { id name score doubleUsedRound }
        rounds { number category status releasedCount
                 questions { number type text imageUrl defaultPoints correctAnswers } }
      }
    }
  }`;

  await new Promise((resolve, reject) => {
    const fail = setTimeout(() => reject(new Error(`${label}: subscribe timed out`)), 15000);
    ws.onerror = (e) => { clearTimeout(fail); reject(new Error(`${label}: ${e.message}`)); };
    ws.onopen = () => ws.send(JSON.stringify({ type: "connection_init" }));
    ws.onmessage = (raw) => {
      const msg = JSON.parse(raw.data);
      if (msg.type === "connection_ack") {
        ws.send(JSON.stringify({
          id, type: "start",
          payload: {
            data: JSON.stringify({ query, variables: { gameId } }),
            extensions: { authorization: auth },
          },
        }));
      } else if (msg.type === "start_ack") {
        clearTimeout(fail);
        resolve();
      } else if (msg.type === "data") {
        events.push(msg.payload.data.onGameUpdated);
      } else if (msg.type === "error") {
        clearTimeout(fail);
        reject(new Error(`${label}: ${JSON.stringify(msg.payload)}`));
      }
    };
  });

  return {
    label,
    events,
    close: () => { ws.send(JSON.stringify({ id, type: "stop" })); ws.close(); },
    // AppSync fan-out is a push; give it a beat to land before asserting.
    settle: () => new Promise((r) => setTimeout(r, 1500)),
  };
}

function gql(apiUrl, apiKey) {
  return async (query, variables = {}) => {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json();
    if (body.errors) {
      const err = new Error(body.errors.map((e) => e.message).join("; "));
      err.graphQLErrors = body.errors;
      throw err;
    }
    return body.data;
  };
}

const apiUrl = process.env.API_URL;
const apiKey = process.env.API_KEY;
const run = gql(apiUrl, apiKey);
// AppSync delivers a subscriber only the fields the *mutation* selected, and it
// matches the `gameId` filter against the mutation's own response — so every
// fan-out mutation has to ask for `gameId` plus everything a tab renders, or
// subscribers get nothing at all.
const UPDATE = `gameId status currentRound event
  player { id displayName teamId }
  game {
    status
    players { id displayName teamId }
    teams { id name score doubleUsedRound }
    rounds { number category status releasedCount
             questions { number type text imageUrl defaultPoints correctAnswers } }
  }`;

const step = (n, s) => console.log(`\n[${n}] ${s}`);
const ok = (s) => console.log(`   ok  ${s}`);

// A 1x1 PNG, so the upload is a real image of a known byte length.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

step(1, "createGame");
const created = await run(`mutation { createGame { gmToken game { id joinCode status } } }`);
const { gmToken } = created.createGame;
const { id: gameId, joinCode } = created.createGame.game;
ok(`game ${gameId} joinCode ${joinCode}`);

step(2, "open two subscriber tabs on onGameUpdated");
const gmTab = await subscribe({ apiUrl, apiKey, gameId, label: "gm-tab" });
const playerTab = await subscribe({ apiUrl, apiKey, gameId, label: "player-tab" });
ok("both tabs subscribed");

step(3, "four players join");
for (const [i, playerId] of ["p1", "p2", "p3", "p4"].entries()) {
  const r = await run(
    `mutation($c:String!,$p:ID!,$n:String!){ joinGame(joinCode:$c,playerId:$p,displayName:$n){ ${UPDATE} } }`,
    { c: joinCode, p: playerId, n: `Player ${i + 1}` },
  );
  assert.equal(r.joinGame.event, "PLAYER_JOINED");
  assert.equal(r.joinGame.player.id, playerId);
}
await gmTab.settle();
const joins = playerTab.events.filter((e) => e.event === "PLAYER_JOINED");
assert.equal(joins.length, 4, `expected 4 PLAYER_JOINED, got ${joins.length}`);
assert.equal(joins.at(-1).game.players.length, 4);
assert.equal(joins.at(-1).player.displayName, "Player 4");
ok("PLAYER_JOINED fanned out to both tabs (the KIO-09 gap)");
assert.equal(gmTab.events.filter((e) => e.event === "PLAYER_JOINED").length, 4);

step(4, "randomizeTeams + setTeamName");
const drawn = await run(
  `mutation($g:ID!,$t:String!){ randomizeTeams(gameId:$g,gmToken:$t,teamCount:2){ ${UPDATE} } }`,
  { g: gameId, t: gmToken },
);
const teams = drawn.randomizeTeams.game.teams;
const players = drawn.randomizeTeams.game.players;
const captains = teams.map((t) => players.find((p) => p.teamId === t.id).id);
await run(
  `mutation($g:ID!,$p:ID!,$t:ID!,$n:String!){ setTeamName(gameId:$g,playerId:$p,teamId:$t,name:$n){ ${UPDATE} } }`,
  { g: gameId, p: captains[0], t: teams[0].id, n: "The Owls" },
);
await gmTab.settle();
ok(`TEAMS_SET + TEAM_RENAMED seen: ${playerTab.events.filter((e) => ["TEAMS_SET", "TEAM_RENAMED"].includes(e.event)).length}`);

step(5, "getImageUploadUrl + real S3 upload");
const signed = await run(
  `mutation($g:ID!,$t:String!,$ct:String!,$cl:Int!){ getImageUploadUrl(gameId:$g,gmToken:$t,contentType:$ct,contentLength:$cl){ uploadUrl imageKey } }`,
  { g: gameId, t: gmToken, ct: "image/png", cl: PNG.length },
);
const put = await fetch(signed.getImageUploadUrl.uploadUrl, {
  method: "PUT",
  headers: { "Content-Type": "image/png", "Content-Length": String(PNG.length) },
  body: PNG,
});
assert.equal(put.status, 200, `upload failed: ${put.status} ${await put.text()}`);
ok(`uploaded ${PNG.length} bytes to ${signed.getImageUploadUrl.imageKey}`);

step(6, "createRound (draft stays hidden from the broadcast)");
await run(
  `mutation($g:ID!,$t:String!,$q:[QuestionInput!]!){ createRound(gameId:$g,gmToken:$t,category:"Mixed",questions:$q){ number status releasedCount } }`,
  {
    g: gameId, t: gmToken,
    q: [
      { type: "TEXT", text: "Capital of France?", correctAnswers: ["Paris"], defaultPoints: 1 },
      { type: "TEXT", text: "Capital of Norway?", correctAnswers: ["Oslo"], defaultPoints: 1 },
      {
        type: "PICTURE_10", imageKey: signed.getImageUploadUrl.imageKey,
        correctAnswers: Array.from({ length: 10 }, (_, i) => `Face ${i + 1}`), defaultPoints: 1,
      },
    ],
  },
);
const draftAsPlayer = await run(`query($g:ID!){ game(gameId:$g){ rounds { number } } }`, { g: gameId });
assert.equal(draftAsPlayer.game.rounds.length, 0, "a DRAFT round leaked to players");
ok("DRAFT round invisible to players");

step(7, "early submission is rejected");
await assert.rejects(
  run(
    `mutation($i:SubmitAnswersInput!){ submitAnswers(input:$i){ event } }`,
    { i: { gameId, playerId: captains[0], roundNumber: 1, answers: [{ questionNumber: 1, answers: ["Paris"] }] } },
  ),
  /not in play/,
);
ok("submitAnswers before startRound rejected");

step(8, "startRound — only question 1 in the broadcast");
await run(`mutation($g:ID!,$t:String!){ startRound(gameId:$g,gmToken:$t,roundNumber:1){ ${UPDATE} } }`, { g: gameId, t: gmToken });
await gmTab.settle();
const started = playerTab.events.find((e) => e.event === "ROUND_STARTED");
assert.ok(started, "no ROUND_STARTED event");
assert.equal(started.game.rounds[0].releasedCount, 1);
assert.equal(started.game.rounds[0].questions.length, 1, "unreleased questions were broadcast");
assert.equal(started.game.rounds[0].questions[0].correctAnswers, null, "answer key was broadcast");
ok("broadcast carried 1 of 3 questions, no answer key");

step(9, "release the rest, choose double, submit");
for (const n of [2, 3]) {
  await run(
    `mutation($g:ID!,$t:String!,$q:Int!){ releaseQuestion(gameId:$g,gmToken:$t,roundNumber:1,questionNumber:$q){ ${UPDATE} } }`,
    { g: gameId, t: gmToken, q: n },
  );
}
await gmTab.settle();
const lastRelease = playerTab.events.filter((e) => e.event === "QUESTION_RELEASED").at(-1);
assert.equal(lastRelease.game.rounds[0].questions.length, 3);
const picture = lastRelease.game.rounds[0].questions.find((q) => q.number === 3);
assert.ok(picture.imageUrl?.includes("X-Amz-Signature"), "picture question had no presigned URL");
ok("all 3 released; PICTURE_10 came back with a presigned imageUrl");

await run(`mutation($g:ID!,$p:ID!){ chooseDouble(gameId:$g,playerId:$p,roundNumber:1){ ${UPDATE} } }`, { g: gameId, p: captains[0] });
const answers = [
  { questionNumber: 1, answers: ["Paris"] },
  { questionNumber: 2, answers: ["Oslo"] },
  { questionNumber: 3, answers: Array.from({ length: 10 }, (_, i) => `Face ${i + 1}`) },
];
for (const p of captains) {
  await run(`mutation($i:SubmitAnswersInput!){ submitAnswers(input:$i){ ${UPDATE} } }`, {
    i: { gameId, playerId: p, roundNumber: 1, answers },
  });
}
await gmTab.settle();
ok(`DOUBLE_CHOSEN + ANSWERS_SUBMITTED seen: ${playerTab.events.filter((e) => ["DOUBLE_CHOSEN", "ANSWERS_SUBMITTED"].includes(e.event)).length}`);

step(10, "grade every response, then endRound");
const toGrade = await run(
  `query($g:ID!,$t:String){ roundResults(gameId:$g,roundNumber:1,gmToken:$t){ responses { questionNumber teamId answers } } }`,
  { g: gameId, t: gmToken },
);
// Scoring is addition only: the server never multiplies, so the GM is the one
// who enters a doubled team's points at 2x. Team[0] chose the double above.
for (const r of toGrade.roundResults.responses) {
  const perAnswer = r.teamId === teams[0].id ? 2 : 1;
  await run(`mutation($i:GradeResponseInput!){ gradeResponse(input:$i){ graded gradedPoints } }`, {
    i: { gameId, gmToken, roundNumber: 1, questionNumber: r.questionNumber, teamId: r.teamId, points: r.answers.map(() => perAnswer) },
  });
}
const ended = await run(`mutation($g:ID!,$t:String!){ endRound(gameId:$g,gmToken:$t,roundNumber:1){ ${UPDATE} } }`, { g: gameId, t: gmToken });
assert.equal(ended.endRound.event, "ROUND_REVEALED");
await gmTab.settle();
const revealed = playerTab.events.find((e) => e.event === "ROUND_REVEALED");
assert.ok(revealed, "no ROUND_REVEALED event");
assert.deepEqual(revealed.game.rounds[0].questions[0].correctAnswers, ["Paris"]);
ok("reveal broadcast carries the answer key, as designed");

step(11, "standings and no GM token anywhere in the broadcasts");
const table = await run(`query($g:ID!){ standings(gameId:$g){ name score doubleUsedRound } }`, { g: gameId });
console.log("   ", JSON.stringify(table.standings));
const doubled = table.standings.find((t) => t.doubleUsedRound === 1);
const plain = table.standings.find((t) => t.doubleUsedRound === null);
assert.ok(doubled, "no team recorded a double");
assert.equal(doubled.score, plain.score * 2, "the GM-entered double did not reach the standings");
const all = JSON.stringify([...gmTab.events, ...playerTab.events]);
assert.ok(!all.includes(gmToken), "GM token appeared in a broadcast");
assert.ok(!all.includes("gmTokenHash"), "gmTokenHash appeared in a broadcast");
ok(`double reached the standings (${doubled.score} vs ${plain.score}); no GM secret in any broadcast`);

console.log(`\n   events: gm-tab ${gmTab.events.length}, player-tab ${playerTab.events.length}`);
console.log(`   ${gmTab.events.map((e) => e.event).join(" → ")}`);
gmTab.close();
playerTab.close();
console.log("\nSMOKE TEST PASSED");
process.exit(0);
