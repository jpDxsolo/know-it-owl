# @know-it-owl/test

All unit tests live here, in a tree that mirrors the packages they cover:

| Source                                  | Test                                         |
|-----------------------------------------|----------------------------------------------|
| `packages/core/src/teams.ts`            | `packages/test/core/src/teams.test.ts`       |
| `packages/functions/src/lib/keys.ts`    | `packages/test/functions/src/lib/keys.test.ts` |

Tests import the code under test by package specifier (`@know-it-owl/core`,
`@know-it-owl/functions/lib/keys`) rather than by relative path, so moving a
test file never breaks its imports.

```sh
npm test -w @know-it-owl/test    # or `npm test` from the repo root
```
