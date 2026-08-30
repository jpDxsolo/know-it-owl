import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppSyncResolverEvent } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { handler } from "@know-it-owl/functions/resolver";

const schema = readFileSync(
  fileURLToPath(new URL("../../../../graphql/schema.graphql", import.meta.url)),
  "utf8",
);

/** Pull the field names out of one top-level type block in the SDL. */
function fieldsOf(typeName: string): string[] {
  const block = new RegExp(`type ${typeName} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!block) throw new Error(`No "type ${typeName}" block in the schema`);
  return [...block[1].matchAll(/^\s{2}(\w+)[(:]/gm)].map((match) => match[1]);
}

function invoke(fieldName: string): Promise<unknown> {
  return handler({
    info: { fieldName },
    arguments: {},
  } as unknown as AppSyncResolverEvent<Record<string, unknown>>);
}

const fields = [...fieldsOf("Query"), ...fieldsOf("Mutation")];

describe("resolver routing", () => {
  it("finds every mutation and query field in the schema", () => {
    expect(fields).toContain("game");
    expect(fields).toContain("createGame");
    expect(fields.length).toBeGreaterThanOrEqual(15);
  });

  it.each(fields)("routes %s to a handler", async (field) => {
    // Handlers fail for their own reasons here (no table, no args); what must
    // never happen is the resolver not knowing the field at all.
    const error = await invoke(field).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(String(error)).not.toMatch(/No handler for field/);
  });

  it("throws for a field that is not in the schema", async () => {
    await expect(invoke("nopeGame")).rejects.toThrow(/No handler for field: nopeGame/);
  });
});
