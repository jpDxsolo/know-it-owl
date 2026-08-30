import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * Types for every operation the frontend sends, generated from the same
 * `graphql/schema.graphql` the API is deployed from — so a schema change breaks
 * the build here rather than at runtime in someone's browser.
 *
 * `documentMode: "string"` emits each operation as a branded string rather than
 * a parsed DocumentNode, which keeps the `graphql` package out of the bundle:
 * the client POSTs the string as-is and only codegen needs the parser.
 */
const config: CodegenConfig = {
  schema: ["../../graphql/schema.graphql", "appsync.graphql"],
  documents: ["src/**/*.ts", "src/**/*.tsx", "!src/gql/**"],
  ignoreNoDocuments: true,
  generates: {
    "src/gql/": {
      preset: "client",
      presetConfig: { fragmentMasking: false },
      config: {
        documentMode: "string",
        useTypeImports: true,
        // Fail on a scalar we have not mapped, rather than quietly emitting
        // `any` for it — the ticket's "no any, including generated code".
        strictScalars: true,
        scalars: { ID: "string" },
        enumsAsTypes: true,
        skipTypename: true,
      },
    },
  },
  hooks: {
    // The preset's own boilerplate contains explicit `any`s that tsc will not
    // flag. See scripts/normalise-generated.mjs.
    afterAllFileWrite: ["node scripts/normalise-generated.mjs"],
  },
};

export default config;
