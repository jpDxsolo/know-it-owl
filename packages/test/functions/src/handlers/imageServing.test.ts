import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGame } from "@know-it-owl/functions/handlers/getGame";
import { setClient } from "@know-it-owl/functions/lib/db";
import { hashGmToken } from "@know-it-owl/functions/lib/gmAuth";
import { setS3Client } from "@know-it-owl/functions/lib/images";
import * as keys from "@know-it-owl/functions/lib/keys";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;
const originalBucket = process.env.IMAGES_BUCKET;

const GM_TOKEN = "gm-secret-token";
const IMAGE_KEY = "games/g1/9f1c2d3e-birds.png";

function stubGame(): void {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({
    Item: {
      ...keys.gameMeta("g1"),
      status: "ROUND_ACTIVE",
      gmTokenHash: hashGmToken(GM_TOKEN),
      joinCode: "ABC234",
      currentRound: 1,
      createdAt: "2026-08-30T00:00:00.000Z",
    },
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "PLAYER#" } }).resolves({ Items: [] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "TEAM#" } }).resolves({ Items: [] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":sk": "ROUND#" } }).resolves({
    Items: [
      { ...keys.round("g1", 1), category: "Birds", status: "ACTIVE", releasedCount: 1 },
      {
        ...keys.question("g1", 1, 1),
        type: "PICTURE_10",
        imageKey: IMAGE_KEY,
        correctAnswers: Array.from({ length: 10 }, (_, i) => `Bird ${i + 1}`),
        defaultPoints: 10,
      },
    ],
  });
}

beforeEach(() => {
  ddbMock.reset();
  process.env.TABLE_NAME = "kio-table";
  process.env.IMAGES_BUCKET = "kio-images";
  setClient(DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" })));
  setS3Client(
    new S3Client({
      region: "eu-west-2",
      credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
    }),
  );
});

afterEach(() => {
  setClient(undefined);
  setS3Client(undefined);
});

afterAll(() => {
  if (originalTableName === undefined) delete process.env.TABLE_NAME;
  else process.env.TABLE_NAME = originalTableName;
  if (originalBucket === undefined) delete process.env.IMAGES_BUCKET;
  else process.env.IMAGES_BUCKET = originalBucket;
});

describe("serving a picture question", () => {
  it("hands a player a signed URL instead of the storage key", async () => {
    stubGame();
    const game = await getGame({ gameId: "g1" });
    const question = game?.rounds[0].questions[0];

    expect(question).not.toHaveProperty("imageKey");
    const url = new URL(question?.imageUrl ?? "");
    expect(url.pathname).toContain(IMAGE_KEY);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("keeps the answer key out of it while signing the image", async () => {
    stubGame();
    const game = await getGame({ gameId: "g1" });
    expect(game?.rounds[0].questions[0].correctAnswers).toBeNull();
    expect(JSON.stringify(game)).not.toContain("Bird 1");
  });

  it("signs for the GM too", async () => {
    stubGame();
    const game = await getGame({ gameId: "g1", gmToken: GM_TOKEN });
    const question = game?.rounds[0].questions[0];
    expect(question?.imageUrl).toContain("X-Amz-Signature");
    expect(question?.correctAnswers).toHaveLength(10);
  });
});
