#!/usr/bin/env node
/**
 * codegen's client preset emits three explicit `any`s in its own boilerplate —
 * the `documents` lookup and `TypedDocumentString.__meta__`. They are invisible
 * to `tsc` (an explicit `any` is not an implicit one), so nothing else would
 * catch them. Narrow them to `unknown`, which those spots never needed to be
 * wider than, and fail loudly if the preset stops emitting them so this does
 * not silently rot.
 */
import { readFile, writeFile } from "node:fs/promises";

const EDITS = [
  {
    file: "src/gql/gql.ts",
    from: "return (documents as any)[source] ?? {};",
    to: "return (documents as Record<string, unknown>)[source] ?? {};",
  },
  {
    file: "src/gql/graphql.ts",
    from: "public __meta__?: Record<string, any> | undefined;",
    to: "public __meta__?: Record<string, unknown> | undefined;",
  },
  {
    file: "src/gql/graphql.ts",
    from: "constructor(value: string, __meta__?: Record<string, any> | undefined) {",
    to: "constructor(value: string, __meta__?: Record<string, unknown> | undefined) {",
  },
];

let changed = 0;
for (const edit of EDITS) {
  const source = await readFile(edit.file, "utf8");
  if (source.includes(edit.to)) continue;
  if (!source.includes(edit.from)) {
    console.error(`normalise-generated: no longer present in ${edit.file}:\n  ${edit.from}`);
    console.error("The codegen preset changed. Re-check its output for `any` and update this script.");
    process.exit(1);
  }
  await writeFile(edit.file, source.replace(edit.from, edit.to));
  changed += 1;
}
console.log(`normalise-generated: ${changed} replacement(s)`);
