# Dev smoke test

How to deploy a stage and prove the whole game works on it — including the parts
unit tests cannot reach: real subscription fan-out, real presigned S3 uploads.

## 1. Deploy

```sh
export AWS_PROFILE=league-szn      # us-east-1, account 435238036810
npx sst install                    # once, to fetch the pulumi providers
npx sst deploy --stage dev
```

The run ends by printing the stack outputs:

| Output        | Value (stage `dev`)                                                                   |
| ------------- | ------------------------------------------------------------------------------------- |
| `api`         | `https://rmoxds4lyrdjhdfr36dhqzn3uu.appsync-api.us-east-1.amazonaws.com/graphql`       |
| `apiRealtime` | `wss://rmoxds4lyrdjhdfr36dhqzn3uu.appsync-realtime-api.us-east-1.amazonaws.com/graphql` |
| `apiKey`      | `da2-hyghrmj5yjg33pl2av5dtilvzi`                                                       |
| `site`        | `https://dp7loru8glau0.cloudfront.net`                                                 |

The API authenticates with `API_KEY`, sent as an `x-api-key` header (and in the
`header` parameter of the realtime handshake). The key is not a secret: the
static site is built with it baked in as `VITE_GRAPHQL_API_KEY`, so it reaches
every browser that loads the app. It is the *GM token* — returned once by
`createGame` — that authorises anything privileged.

To re-read the outputs later without deploying, or after rotating the key:

```sh
npx sst deploy --stage dev          # prints them again; no-ops if nothing changed
aws appsync list-api-keys --api-id <id> --region us-east-1
```

The key expires on the first of the month roughly a year out; `sst.config.ts`
rounds it that way so the deploy plan does not churn on every run. Redeploy to
renew it.

## 2. Run the smoke test

```sh
API_URL=<api> API_KEY=<apiKey> node scripts/dev-smoke-test.mjs
```

It plays one whole game and exits non-zero on the first failed assertion. A
passing run ends with:

```
   events: gm-tab 13, player-tab 13
   PLAYER_JOINED → PLAYER_JOINED → PLAYER_JOINED → PLAYER_JOINED → TEAMS_SET →
   TEAM_RENAMED → ROUND_STARTED → QUESTION_RELEASED → QUESTION_RELEASED →
   DOUBLE_CHOSEN → ANSWERS_SUBMITTED → ANSWERS_SUBMITTED → ROUND_REVEALED

SMOKE TEST PASSED
```

What each step is actually guarding:

| Step | Checks |
| ---- | ------ |
| 1–2  | `createGame`; two subscribers attach to `onGameUpdated` before anything happens |
| 3    | Four joins each reach **both** tabs as `PLAYER_JOINED` — the gap KIO-09 closed |
| 4    | `randomizeTeams`, `setTeamName` fan out |
| 5    | A real 70-byte PNG is `PUT` to the presigned URL and returns 200 |
| 6    | A `DRAFT` round is invisible to the player view — not even its category |
| 7    | `submitAnswers` before `startRound` is rejected |
| 8    | The `ROUND_STARTED` broadcast carries 1 of 3 questions and no answer key |
| 9    | Both remaining questions release; the `PICTURE_10` comes back with a presigned `imageUrl` |
| 10   | Every response is graded, `endRound` reveals, and only then do answer keys appear |
| 11   | The double reaches the standings, and no GM token or hash is in any broadcast |

## 3. The same thing by hand, in the AppSync console

Open **AppSync → `know-it-owl-dev-Api…` → Queries**, set the auth mode to
**API key**, and use two browser tabs: one as the GM, one as a player.

1. **Player tab.** Run `createGame` first in the GM tab to get a `gameId`, then
   start the subscription here and leave it running:

   ```graphql
   subscription Watch($gameId: ID!) {
     onGameUpdated(gameId: $gameId) {
       gameId event status player { displayName }
       game { players { displayName teamId } rounds { releasedCount questions { number text correctAnswers } } }
     }
   }
   ```

2. **GM tab.** Work down the mutation list — `joinGame`, `randomizeTeams`,
   `setTeamName`, `createRound`, `startRound`, `releaseQuestion`, `chooseDouble`,
   `submitAnswers`, `gradeResponse`, `endRound` — watching each event land in the
   player tab.

**The one trap.** AppSync sends a subscriber only the fields the *mutation*
selected, and it matches the `gameId` filter against the mutation's own
response. A mutation that omits `gameId` from its selection set delivers
**nothing at all** — the subscription looks broken when it is not. So every
fan-out mutation must select `gameId` plus whatever the subscriber renders:

```graphql
mutation Join($c: String!, $p: ID!, $n: String!) {
  joinGame(joinCode: $c, playerId: $p, displayName: $n) {
    gameId status currentRound event      # gameId is what makes the filter match
    player { id displayName teamId }
    game { players { id displayName teamId } }
  }
}
```

## What the fan-out guarantees

The eight mutations in the `@aws_subscribe` list on `onGameUpdated` return a
`GameUpdate`, and that object goes to *every* subscriber. So each one builds its
snapshot as a **player** view, whatever the caller's privileges — the GM's own
`releaseQuestion` still broadcasts the player-visible subset.
`walkthrough.test.ts` holds all eight to that, and step 8 above confirms it on
real infrastructure.

`joinGame` returns a `GameUpdate` for this reason and no other: AppSync only
delivers a mutation's own return type to `@aws_subscribe`, so its old bespoke
`JoinGamePayload` could not be subscribed to at all. The seat the joiner was
given rides along on `GameUpdate.player`, which is set on `PLAYER_JOINED` and
null everywhere else.

## Tearing down

```sh
npx sst remove --stage dev
```
