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

    const lambdaSource = api.addDataSource({
      name: "lambda",
      lambda: {
        handler: "packages/functions/src/resolver.handler",
        link: [table, images],
      },
    });

    const mutations = [
      "createGame",
      "joinGame",
      "randomizeTeams",
      "setTeamName",
      "createRound",
      "startRound",
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
      },
    });

    return {
      api: api.url,
      site: site.url,
    };
  },
});
