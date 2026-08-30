# Poking at the dev API by hand

Everything here runs against the deployed `dev` stage. If you want the whole
game driven automatically instead, that is `scripts/dev-smoke-test.mjs` — see
[dev-smoke-test.md](./dev-smoke-test.md). This document is for exploring by
hand, and for the failure cases worth trying deliberately.

## Where to point things

| | |
| --- | --- |
| **GraphQL endpoint** | `https://rmoxds4lyrdjhdfr36dhqzn3uu.appsync-api.us-east-1.amazonaws.com/graphql` |
| **Realtime endpoint** | `wss://rmoxds4lyrdjhdfr36dhqzn3uu.appsync-realtime-api.us-east-1.amazonaws.com/graphql` |
| **Auth** | header `x-api-key: da2-hyghrmj5yjg33pl2av5dtilvzi` |
| **Deployed site** | https://dp7loru8glau0.cloudfront.net |
| **AppSync console** | https://us-east-1.console.aws.amazon.com/appsync/home?region=us-east-1#/s7ul5ccv4ndsne2wycorhkh7ey/v1/queries |

The API key is not a secret — the static site is built with it baked in, so it
reaches every browser that loads the app. The thing that actually authorises
anything is the **GM token**, returned once by `createGame` and never again.
Losing it means losing control of that game.

`npx sst deploy --stage dev` reprints all of these.

---

## Option A — the AppSync console (easiest, and the only easy way to see subscriptions)

Open the console link above and set **API key** as the auth mode. The Queries
page has a schema-aware editor and, uniquely among the options here, it speaks
AppSync's realtime protocol for you.

To watch the fan-out, use **two browser tabs on that same page**: one as the GM
running mutations, one as a player with a subscription open.

**Player tab** — run this and leave it running:

```graphql
subscription Watch($gameId: ID!) {
  onGameUpdated(gameId: $gameId) {
    gameId event status currentRound
    player { id displayName teamId }
    game {
      players { id displayName teamId }
      teams { id name score doubleUsedRound }
      rounds { number category status releasedCount
               questions { number type text imageUrl correctAnswers } }
    }
  }
}
```

**GM tab** — work down the sequence in [Things to try](#things-to-try) and watch
each event land in the player tab.

> ### The one trap that will waste your afternoon
>
> AppSync sends a subscriber **only the fields the mutation selected**, and it
> matches the `gameId` filter argument against the mutation's own response.
>
> A mutation that omits `gameId` from its selection set delivers **nothing at
> all** to subscribers. The mutation succeeds, returns normally, and the
> subscription just sits there — indistinguishable from a broken subscription.
>
> ```graphql
> mutation { joinGame(joinCode:"ABC123", playerId:"p1", displayName:"Ada") { event } }
> # ✗ succeeds, fans out nothing — no gameId in the selection
>
> mutation { joinGame(joinCode:"ABC123", playerId:"p1", displayName:"Ada") { gameId event game { players { id } } } }
> # ✓ subscribers receive gameId, event and game.players — and nothing else
> ```
>
> So: always select `gameId`, plus every field the subscriber renders.

---

## Option B — Postman

### Queries and mutations

Postman handles these fine.

1. **POST** to the GraphQL endpoint.
2. Headers: `x-api-key: da2-hyghrmj5yjg33pl2av5dtilvzi`.
3. Body → **GraphQL**. Paste the query in the top pane and variables in the
   bottom one.

Postman's "fetch schema" button works with the API key header set, so you get
autocomplete.

Worth setting up as a collection with variables, because you will paste the
same three values constantly:

| Variable | Set from |
| --- | --- |
| `baseUrl` | the endpoint above |
| `apiKey` | the key above |
| `gameId` | `createGame` → `data.createGame.game.id` |
| `joinCode` | `createGame` → `data.createGame.game.joinCode` |
| `gmToken` | `createGame` → `data.createGame.gmToken` |

A **Post-response script** on `createGame` saves the round-trip:

```js
const d = pm.response.json().data.createGame;
pm.collectionVariables.set("gameId", d.game.id);
pm.collectionVariables.set("joinCode", d.game.joinCode);
pm.collectionVariables.set("gmToken", d.gmToken);
```

### Subscriptions in Postman

Postman's built-in GraphQL subscription support talks standard `graphql-ws`.
**AppSync does not** — it uses its own variant of that subprotocol, so the
built-in support will not connect. Use a **raw WebSocket request** instead and
send the frames yourself.

Connect to, all on one line:

```
wss://rmoxds4lyrdjhdfr36dhqzn3uu.appsync-realtime-api.us-east-1.amazonaws.com/graphql?header=eyJob3N0Ijoicm1veGRzNGx5cmRqaGRmcjM2ZGhxem4zdXUuYXBwc3luYy1hcGkudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20iLCJ4LWFwaS1rZXkiOiJkYTItaHlnaHJtajV5amczM3BsMmF2NWR0aWx2emkifQ==&payload=e30=
```

with subprotocol `graphql-ws`. That `header` value is just base64 of:

```json
{ "host": "rmoxds4lyrdjhdfr36dhqzn3uu.appsync-api.us-east-1.amazonaws.com",
  "x-api-key": "da2-hyghrmj5yjg33pl2av5dtilvzi" }
```

Note the **host is the `appsync-api` host, not the realtime one** — signing it
with the realtime host is the usual reason a handshake is rejected.

Then send, in order:

```json
{"type":"connection_init"}
```

wait for `connection_ack`, then (with your own `gameId`):

```json
{"id":"1","type":"start","payload":{
  "data":"{\"query\":\"subscription($gameId: ID!) { onGameUpdated(gameId: $gameId) { gameId event status player { displayName } game { players { displayName teamId } } } }\",\"variables\":{\"gameId\":\"PUT-GAME-ID-HERE\"}}",
  "extensions":{"authorization":{
    "host":"rmoxds4lyrdjhdfr36dhqzn3uu.appsync-api.us-east-1.amazonaws.com",
    "x-api-key":"da2-hyghrmj5yjg33pl2av5dtilvzi"}}}}
```

The `data` field is a **JSON-encoded string**, not an object — that is the part
everyone gets wrong. You should get `start_ack`, then periodic `ka` keep-alives,
then a `data` frame per event. `{"id":"1","type":"stop"}` unsubscribes.

Honestly: if you only want to *see* the fan-out, the AppSync console is less
work. Reach for this when you need Postman's scripting around it.

---

## Option C — curl

```sh
export API=https://rmoxds4lyrdjhdfr36dhqzn3uu.appsync-api.us-east-1.amazonaws.com/graphql
export KEY=da2-hyghrmj5yjg33pl2av5dtilvzi

gql() { curl -s -X POST "$API" -H "x-api-key: $KEY" -H 'Content-Type: application/json' \
          --data-binary "$(jq -nc --arg q "$1" '{query:$q}')" | jq; }

gql 'mutation { createGame { gmToken game { id joinCode status } } }'
```

curl cannot hold a subscription open. Use the console, or
`scripts/dev-smoke-test.mjs`, for that.

---

## Things to try

Run these roughly in order — most of them depend on the game being in the right
state. Keep a subscription open the whole time.

### The happy path

| # | Do this | Expect |
| --- | --- | --- |
| 1 | `createGame` | a `gameId`, a 6-character `joinCode`, `status: LOBBY`, and the `gmToken`. Save all three. |
| 2 | `joinGame` four times with different `playerId`s | each returns `event: PLAYER_JOINED` and `player`; **each one reaches the subscriber** |
| 3 | `randomizeTeams(teamCount: 2)` | `TEAMS_SET`; every player now has a `teamId` |
| 4 | `setTeamName` as a player on that team | `TEAM_RENAMED` |
| 5 | `getImageUploadUrl(contentType:"image/png", contentLength: <exact bytes>)` | a presigned `uploadUrl` and an `imageKey` |
| 6 | `PUT` the file to `uploadUrl` with a matching `Content-Type` | HTTP 200 |
| 7 | `createRound` with two `TEXT` questions and one `PICTURE_10` carrying that `imageKey` | round 1, `status: DRAFT` |
| 8 | `startRound` | `ROUND_STARTED`, `releasedCount: 1` |
| 9 | `releaseQuestion` for 2, then 3 | `QUESTION_RELEASED` each time; the `PICTURE_10` comes back with a presigned `imageUrl` |
| 10 | `chooseDouble` as one team | `DOUBLE_CHOSEN`; that team's `doubleUsedRound` is set |
| 11 | `submitAnswers` once per team | `ANSWERS_SUBMITTED` |
| 12 | `roundResults` **with** the `gmToken` | every team's answers, for grading |
| 13 | `gradeResponse` for each response | `graded: true`. Scoring is addition only — the server never multiplies, so enter the doubled team's points at **2×** yourself |
| 14 | `endRound` | `ROUND_REVEALED`; scores fold into the standings |
| 15 | `standings` | the doubled team ahead, by exactly what you entered |

### Things that should fail

These are the interesting ones. Each message below is the real response from the
dev stage.

| Try | Expect |
| --- | --- |
| Any call with no `x-api-key` header, or a wrong one | `UnauthorizedException: You are not authorized to make this call.` |
| `joinGame` with a made-up join code | `No game with that join code` |
| `joinGame` with a name another player already has (case-insensitively) | `"ada" is already taken in this game` |
| `joinGame` with a `playerId` that already joined | **succeeds** — deliberately idempotent, so a refresh is not a second player. Only the display name updates |
| Any GM mutation with a wrong `gmToken` | `Invalid game master token` |
| `randomizeTeams(teamCount: 5)` with 4 players | `teamCount (5) cannot exceed the number of players (4)` |
| `randomizeTeams` after a round exists | `Teams cannot be randomized once a round has been created` |
| `submitAnswers` before `startRound` | `Round 1 is not in play` |
| `releaseQuestion` for a number past the end | `Round 1 has no question 3` |
| `releaseQuestion` skipping ahead (3 while 1 is released) | `Question 3 is not next in round 1 (released 1)` — release is strictly sequential |
| `submitAnswers` while questions are unreleased | `Round 1 still has unreleased questions (1 of 2)` |
| A second `submitAnswers` from the same team | `Your team has already submitted this round` |
| `chooseDouble` after that team handed in | `Your team has already submitted this round` |
| A second `chooseDouble` in a later round | refused — one double per game |
| `endRound` with a team still outstanding | `Cannot end round 1: Team 2 has not submitted` |
| `getImageUploadUrl(contentType: "application/pdf")` | `"application/pdf" is not an allowed image type (image/jpeg, image/png, image/webp, image/gif)` |
| `getImageUploadUrl(contentLength: 99999999)` | `"contentLength" must be at most 10485760` |
| `PUT` a body of a different length than you signed for | HTTP 403 from S3 — the length is signed into the URL |
| `PUT` with a different `Content-Type` than you signed for | HTTP 403 from S3 |
| `game(gameId: "nope")` | `null`, not an error — the field is nullable |

### Things that should not leak

This is the part most worth checking by hand, because getting it wrong is
invisible until someone wins a quiz they shouldn't have.

| Try | Expect |
| --- | --- |
| `game(gameId:)` **without** a `gmToken`, while round 1 is `DRAFT` | `rounds: []`. Not even the category |
| The same query **with** the `gmToken` | the round, all its questions, but still no `correctAnswers` |
| `game` without a token after `startRound` | exactly one question — `releasedCount` of them, never more |
| `correctAnswers` anywhere before the reveal | `null`, on every path, for everyone including the GM |
| `correctAnswers` in the `ROUND_REVEALED` broadcast | populated — this is where they become public |
| `roundResults` as a player before the reveal | `These results are not public until the round is revealed` |
| The same after `endRound` | public, with the answers |
| `gmToken` or `gmTokenHash` in **any** subscription payload | never present |
| The `ROUND_STARTED` broadcast, as the GM who triggered it | the *player* view — one question, no answer key. Every fan-out is a player snapshot regardless of who caused it |

That last row is the invariant the whole design rests on: a `GameUpdate` goes to
every subscriber, so it is always built as a player view, however privileged the
caller was. `packages/test/functions/src/walkthrough.test.ts` holds all eight
subscribed mutations to it.

## When something looks broken

- **Subscription connects but never fires.** Almost always the trap above — the
  mutation did not select `gameId`. Check the mutation, not the subscription.
- **Realtime handshake rejected.** The `host` in the auth header must be the
  `appsync-api` host, not the `appsync-realtime-api` one.
- **A field comes back `null` on a subscriber** that you can see in the mutation
  response. The mutation did not select it, so it was never sent.
- **HTTP 403 on upload.** `Content-Length` and `Content-Type` are both signed
  into the URL and must match exactly.
- **`UnauthorizedException` everywhere, suddenly.** The API key expires; it is
  renewed on redeploy. `aws appsync list-api-keys --api-id s7ul5ccv4ndsne2wycorhkh7ey --region us-east-1`
  shows the expiry.
- **Lambda errors.** There is no `sst logs` command; tail CloudWatch directly.
  Every handler error is logged with its `errorType` and message:

  ```sh
  aws logs tail /aws/lambda/know-it-owl-dev-ApiDataSourceLambdaFunctionFunction-sesnrmux \
    --region us-east-1 --since 10m --follow
  ```

  That name changes when the function is replaced, so find the current one with:

  ```sh
  aws logs describe-log-groups --region us-east-1 \
    --query "logGroups[?contains(logGroupName,'know-it-owl')].logGroupName" --output text
  ```
