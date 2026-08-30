# Know It Owl

Serverless team trivia web app. Players join a lobby with a display name (no login), a game
master randomizes even teams, enters questions (text Q&A or "identify 10 items in a picture"),
teams answer in real time, the GM grades and assigns points, and scores are revealed per round.
Each team may double one round's score per game.

**Stack:** AWS AppSync (GraphQL + subscriptions) · Lambda · DynamoDB · S3 · SST v3 · React + Vite.

See [PLAN.md](./PLAN.md) for the full product and architecture plan.

## Repo layout

- `packages/core` — shared domain logic and types (team randomization lives here)
- `packages/functions` — Lambda resolver stubs for the AppSync API
- `packages/frontend` — Vite React SPA (placeholder screens)
- `packages/test` — all unit tests, in a tree mirroring the packages they cover
- `graphql/schema.graphql` — GraphQL schema
- `sst.config.ts` — SST v3 infrastructure definition

## Development

```sh
npm install            # install all workspaces
npm test               # run all unit tests (vitest, packages/test)
npm run typecheck      # typecheck all workspaces
npm run build          # build the frontend
npx sst dev            # live-develop against AWS (requires AWS credentials)
npx sst deploy         # deploy
```
