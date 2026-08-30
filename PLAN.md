# Know It Owl — Product & Architecture Plan

## Product overview

A serverless team trivia web app for casual groups (pub-quiz style, run over a video call or in
person). No accounts: players join a game with a join code and a display name. One person is the
**game master (GM)** who creates the game, randomizes teams, writes questions, grades answers,
and reveals results.

### Game flow

1. **Create game** — GM creates a game and receives a join code (shared with players) and a
   secret GM token (kept private; authorizes GM-only mutations).
2. **Lobby** — players join with a display name; everyone sees the lobby fill up in real time.
3. **Randomize teams** — GM picks a team count; the server shuffles players and deals them
   round-robin so team sizes differ by at most one (20 players / 3 teams → 7, 7, 6). Teams may
   rename themselves.
4. **Rounds** — GM creates a round (category + questions) and starts it. Questions are either:
   - **TEXT** — one free-text answer per team.
   - **PICTURE_10** — an image with 10 items to identify; teams submit 10 answers.
5. **Doubling** — before submitting a round's answers, a team may flag that round as their
   **double**. Each team may double exactly one round per game (enforced server-side). When the
   round is graded, that team's points for the round are multiplied by 2.
6. **Answering** — one submission per team per round. Teammates coordinate out-of-band (or via
   whoever holds the "captain" device); any team member may edit until submission.
7. **Grading** — GM sees each team's responses per question, marks correct/incorrect, and
   assigns points (defaulting to the question's point value).
8. **Reveal** — GM ends the round; everyone sees the correct answers, per-team round scores
   (with doubles applied), and updated standings.
9. **Finish** — after the last round, final standings are shown.

## Architecture

- **AppSync GraphQL API** (`sst.aws.AppSync`) — queries, mutations, and subscriptions. API-key
  auth for v1. Single Lambda data source; a TypeScript resolver routes by field name.
- **DynamoDB** (`sst.aws.Dynamo`) — single table, composite key `pk`/`sk`.
- **S3** (`sst.aws.Bucket`) — picture-round images, uploaded by the GM via presigned URL
  (`getImageUploadUrl` mutation), served via presigned GET or CloudFront.
- **Frontend** — React SPA (Vite + TypeScript) deployed with `sst.aws.StaticSite`
  (S3 + CloudFront).

### Real-time model

One coarse-grained subscription, `onGameUpdated(gameId)`, carries every game state change
(player joined, teams set, round started, reveal, …). Mutations that change game state return a
`GameUpdate` payload which AppSync fans out to subscribers. Clients re-query details they care
about (or use the embedded snapshot). This is the simplest reliable AppSync pattern and avoids
subscription-per-entity complexity.

### Auth (v1 and later)

- **v1:** no login. Players generate a `playerId` client-side (UUID, persisted in
  localStorage) and pass it in mutations. The GM receives a `gmToken` at game creation; GM-only
  mutations require it (hash stored on the game record).
- **Later:** AppSync supports multiple simultaneous auth modes, so a Cognito User Pool can be
  added as an additional auth mode without restructuring — map `playerId` to the Cognito `sub`
  and mark GM via a claim or ownership check.

## Data model (DynamoDB single table)

| pk           | sk                              | Attributes |
|--------------|---------------------------------|------------|
| `GAME#<id>`  | `META`                          | status (LOBBY \| TEAMS_SET \| ROUND_ACTIVE \| GRADING \| REVEAL \| FINISHED), gmTokenHash, joinCode, currentRound, createdAt |
| `GAME#<id>`  | `PLAYER#<playerId>`             | displayName, teamId |
| `GAME#<id>`  | `TEAM#<teamId>`                 | name, score, doubleUsedRound (null until used) |
| `GAME#<id>`  | `ROUND#<n>`                     | category, status, releasedCount |
| `GAME#<id>`  | `ROUND#<n>#Q#<qn>`              | type (TEXT \| PICTURE_10), text, imageKey, correctAnswers[], defaultPoints |
| `GAME#<id>`  | `RESP#<round>#<qn>#TEAM#<tid>`  | answers[] (1 for TEXT, 10 for PICTURE_10), doubled, gradedPoints[], graded |
| `GAME#<id>`  | `RESP#<round>#SUBMIT#TEAM#<tid>`| teamId, submittedAt, doubled — one per team per round; written with the answers under `attribute_not_exists` so a double submit is impossible |

All access patterns are `Query pk = GAME#<id>` with an `sk` prefix (`begins_with`), so no GSIs
are needed for v1.

## GraphQL schema outline

See `graphql/schema.graphql` for the full schema.

- **Mutations:** `createGame`, `joinGame`, `randomizeTeams`, `setTeamName`, `createRound`,
  `startRound`, `chooseDouble`, `submitAnswers`, `gradeResponse`, `endRound`,
  `getImageUploadUrl`
- **Queries:** `game`, `myTeam`, `roundResults`, `standings`
- **Subscriptions:** `onGameUpdated(gameId)`

## Team-split algorithm

`randomizeTeams(playerIds, teamCount)` in `packages/core/src/teams.ts`:

1. Fisher–Yates shuffle of the player list (injectable RNG for testability).
2. Deal round-robin into `teamCount` teams.

Result: team sizes differ by at most 1 (e.g., 20 / 3 → 7, 7, 6). Unit-tested with vitest.

## Doubling rules

- A team flags "double" for the current round **before** submitting its answers
  (`chooseDouble` mutation, or the `doubled` flag on `submitAnswers`).
- Server rejects the flag if `doubleUsedRound` is already set for that team.
- On `endRound`, each team's graded points for the round are summed; doubled teams get ×2;
  `doubleUsedRound` is recorded.

## Future work

- **Auth extensibility:** add a Cognito User Pool as an additional AppSync auth mode; map
  `playerId` → Cognito `sub`; GM authorization via claim instead of token.
- **Google Stitch UI:** connect the Stitch MCP server (or use stitch.withgoogle.com) to generate
  screen designs for: Join, Lobby, TeamRound (TEXT and PICTURE_10 layouts), GmDashboard,
  GmGrading, RoundReveal, Standings. Export React/Tailwind into `packages/frontend` replacing
  the placeholder screens.
- Reconnect/resume handling; kick/rename players; timed rounds; sound effects; spectator view.
- Image moderation / size limits on uploads; CloudFront-signed image URLs.
