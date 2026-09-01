import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every field in the schema needs a resolver attached in `sst.config.ts`.
 *
 * A mutation's name has to appear in four places: the schema's type, the
 * schema's `@aws_subscribe` list if it fans out, the router in `resolver.ts`,
 * and the resolver list in `sst.config.ts`. Miss the last one and AppSync
 * accepts the field, attaches nothing to it, and answers every call with
 * "Cannot return null for non-nullable type" — a deployment that builds, tests
 * green, deploys clean, and fails the moment a person presses the button.
 *
 * That is exactly what happened to `finishGame`. Nothing else in the repo looks
 * at `sst.config.ts`: it is excluded from workspace typechecking until
 * `sst install` has run, and no other test reads it.
 */
const root = resolve(process.cwd(), "..", "..");

/** Field names declared under `type Mutation` / `type Query` in the schema. */
function schemaFields(schema: string, typeName: string): string[] {
  const block = schema.split(`type ${typeName} {`)[1]?.split("\n}")[0] ?? "";
  return block
    .split("\n")
    .map((line) => line.trim())
    // Descriptions are quoted strings on their own line; skip those and blanks.
    .filter((line) => line.length > 0 && !line.startsWith('"') && !line.startsWith("#"))
    .map((line) => line.split(/[(:]/)[0].trim())
    .filter((name) => name.length > 0);
}

/** The string literals in a `const <name> = [ … ]` array in the infra config. */
function configuredFields(config: string, name: string): string[] {
  const body = config.split(`const ${name} = [`)[1]?.split("]")[0] ?? "";
  return [...body.matchAll(/"([a-zA-Z]+)"/g)].map((match) => match[1]);
}

describe("every schema field has a resolver", () => {
  const schema = readFileSync(resolve(root, "graphql/schema.graphql"), "utf8");
  const config = readFileSync(resolve(root, "sst.config.ts"), "utf8");

  it("attaches one to every mutation", () => {
    expect(configuredFields(config, "mutations").sort()).toEqual(
      schemaFields(schema, "Mutation").sort(),
    );
  });

  it("attaches one to every query", () => {
    expect(configuredFields(config, "queries").sort()).toEqual(
      schemaFields(schema, "Query").sort(),
    );
  });

  it("routes every mutation and query to a handler", () => {
    // The other half of the same trap: wired into AppSync but not into the
    // Lambda's own router is a runtime 500 rather than a null.
    const router = readFileSync(
      resolve(root, "packages/functions/src/resolver.ts"),
      "utf8",
    );
    const routed = router.split("const handlers: Record<string, Handler> = {")[1]?.split("};")[0] ?? "";
    for (const field of [
      ...schemaFields(schema, "Mutation"),
      ...schemaFields(schema, "Query"),
    ]) {
      // `Query.game` is served by `getGame`, so accept an explicit mapping too.
      expect(routed.includes(`\n  ${field},`) || routed.includes(`\n  ${field}:`)).toBe(true);
    }
  });
});
