/// <reference path="./.sst/platform/config.d.ts" />

// NOTE: run `npx sst install` once to generate .sst/platform types.
// This file is excluded from workspace typechecking until then.

export default $config({
  app(input) {
    return {
      name: "know-it-owl",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const table = new sst.aws.Dynamo("Table", {
      fields: { pk: "string", sk: "string" },
      primaryIndex: { hashKey: "pk", rangeKey: "sk" },
    });

    const images = new sst.aws.Bucket("Images");

    const api = new sst.aws.AppSync("Api", {
      schema: "graphql/schema.graphql",
    });

    // The API defaults to API_KEY auth but ships without a key, so nothing can
    // actually call it until we make one. AppSync caps a key's life at 365 days
    // and refuses a date in the past; rounding the expiry down to the start of a
    // UTC month keeps it ~a year out while only changing the plan once a month,
    // instead of on every single deploy.
    const keyExpiry = new Date();
    const apiKey = new aws.appsync.ApiKey("ApiKey", {
      apiId: api.id,
      description: `know-it-owl ${$app.stage}`,
      expires: new Date(
        Date.UTC(keyExpiry.getUTCFullYear() + 1, keyExpiry.getUTCMonth(), 1),
      )
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z"),
    });

    const lambdaSource = api.addDataSource({
      name: "lambda",
      lambda: {
        handler: "packages/functions/src/resolver.handler",
        // `link` grants the IAM permissions, but SST v3 hands the resource
        // names to the runtime through an encrypted bundled file rather than
        // `SST_RESOURCE_*` env vars. The handlers read plain names, so pass
        // them through the overrides they already document.
        link: [table, images],
        environment: {
          TABLE_NAME: table.name,
          IMAGES_BUCKET: images.name,
        },
      },
    });

    const mutations = [
      "createGame",
      "joinGame",
      "randomizeTeams",
      "setTeamName",
      "createRound",
      "startRound",
      "releaseQuestion",
      "chooseDouble",
      "submitAnswers",
      "gradeResponse",
      "endRound",
      "getImageUploadUrl",
    ];
    const queries = ["game", "myTeam", "roundResults", "standings"];

    for (const field of mutations) {
      api.addResolver(`Mutation ${field}`, { dataSource: lambdaSource.name });
    }
    for (const field of queries) {
      api.addResolver(`Query ${field}`, { dataSource: lambdaSource.name });
    }

    const site = new sst.aws.StaticSite("Site", {
      path: "packages/frontend",
      build: {
        command: "npm run build",
        output: "dist",
      },
      environment: {
        VITE_GRAPHQL_URL: api.url,
        VITE_GRAPHQL_REALTIME_URL: api.nodes.api.uris["REALTIME"],
        VITE_GRAPHQL_API_KEY: apiKey.key,
      },
    });

    return {
      api: api.url,
      apiRealtime: api.nodes.api.uris["REALTIME"],
      apiKey: apiKey.key,
      site: site.url,
    };
  },
});
