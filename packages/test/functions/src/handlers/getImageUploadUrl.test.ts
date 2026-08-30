import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { getImageUploadUrl } from "@know-it-owl/functions/handlers/getImageUploadUrl";
import { setClient } from "@know-it-owl/functions/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@know-it-owl/functions/lib/errors";
import { hashGmToken } from "@know-it-owl/functions/lib/gmAuth";
import { MAX_IMAGE_BYTES, setS3Client } from "@know-it-owl/functions/lib/images";
import * as keys from "@know-it-owl/functions/lib/keys";

const ddbMock = mockClient(DynamoDBDocumentClient);
const originalTableName = process.env.TABLE_NAME;
const originalBucket = process.env.IMAGES_BUCKET;

const GM_TOKEN = "gm-secret-token";

function stubGame(): void {
  ddbMock.on(GetCommand, { Key: keys.gameMeta("g1") }).resolves({
    Item: {
      ...keys.gameMeta("g1"),
      status: "TEAMS_SET",
      gmTokenHash: hashGmToken(GM_TOKEN),
      joinCode: "ABC234",
      currentRound: null,
      createdAt: "2026-08-30T00:00:00.000Z",
    },
  });
  ddbMock.on(QueryCommand).resolves({ Items: [] });
}

const args = { gameId: "g1", gmToken: GM_TOKEN, contentType: "image/png", contentLength: 2048 };

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

describe("getImageUploadUrl", () => {
  it("returns a game-scoped key and a signed PUT for it", async () => {
    stubGame();
    const { uploadUrl, imageKey } = await getImageUploadUrl(args);

    expect(imageKey).toMatch(/^games\/g1\/[0-9a-f-]{36}$/);
    expect(new URL(uploadUrl).pathname).toContain(imageKey);
    expect(new URL(uploadUrl).searchParams.get("X-Amz-Expires")).toBe("900");
  });

  it("refuses a caller without a valid GM token", async () => {
    stubGame();
    await expect(getImageUploadUrl({ ...args, gmToken: "wrong" })).rejects.toThrow(ForbiddenError);
    await expect(getImageUploadUrl({ ...args, gmToken: "" })).rejects.toThrow(ValidationError);
  });

  it("refuses a disallowed content type", async () => {
    stubGame();
    await expect(getImageUploadUrl({ ...args, contentType: "application/pdf" })).rejects.toThrow(
      /not an allowed image type/,
    );
  });

  it("refuses an upload over the cap", async () => {
    stubGame();
    await expect(
      getImageUploadUrl({ ...args, contentLength: MAX_IMAGE_BYTES + 1 }),
    ).rejects.toThrow(ValidationError);
  });

  it("requires a content length", async () => {
    stubGame();
    await expect(getImageUploadUrl({ ...args, contentLength: undefined })).rejects.toThrow(
      ValidationError,
    );
  });

  it("refuses an unknown game", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(getImageUploadUrl(args)).rejects.toThrow(NotFoundError);
  });
});
