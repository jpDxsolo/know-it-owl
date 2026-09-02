import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@know-it-owl/functions/lib/errors";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
  UPLOAD_URL_TTL_SECONDS,
  VIEW_URL_TTL_SECONDS,
  bucketName,
  createUploadUrl,
  createViewUrl,
  newImageKey,
  setS3Client,
  signRounds,
} from "@know-it-owl/functions/lib/images";
import type { VisibleRound } from "@know-it-owl/functions/lib/visibility";

const originalBucket = process.env.IMAGES_BUCKET;

/**
 * Presigning is a local computation, so a client with static credentials
 * produces a real, inspectable URL without any network call.
 */
function testClient(): S3Client {
  return new S3Client({
    region: "eu-west-2",
    credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
  });
}

function question(number: number, imageKey?: string) {
  return {
    roundNumber: 1,
    number,
    type: imageKey ? ("PICTURE_10" as const) : ("TEXT" as const),
    ...(imageKey ? { imageKey } : { text: `Q${number}` }),
    defaultPoints: 1,
    correctAnswers: null,
  };
}

function round(questions: ReturnType<typeof question>[]): VisibleRound {
  return {
    number: 1,
    category: "Birds",
    status: "ACTIVE",
    releasedCount: 2,
    doublingAllowed: true,
    questionCount: questions.length,
    questions,
  };
}

beforeEach(() => {
  process.env.IMAGES_BUCKET = "kio-images";
  setS3Client(testClient());
});

afterEach(() => {
  setS3Client(undefined);
  delete process.env.SST_RESOURCE_Images;
});

afterAll(() => {
  if (originalBucket === undefined) delete process.env.IMAGES_BUCKET;
  else process.env.IMAGES_BUCKET = originalBucket;
});

describe("bucketName", () => {
  it("prefers IMAGES_BUCKET", () => {
    expect(bucketName()).toBe("kio-images");
  });

  it("falls back to the linked SST resource", () => {
    delete process.env.IMAGES_BUCKET;
    process.env.SST_RESOURCE_Images = JSON.stringify({ name: "linked-bucket", type: "bucket" });
    expect(bucketName()).toBe("linked-bucket");
  });

  it("throws when nothing is configured", () => {
    delete process.env.IMAGES_BUCKET;
    expect(() => bucketName()).toThrow(/not configured/);
  });
});

describe("newImageKey", () => {
  it("scopes the key to the game", () => {
    expect(newImageKey("g1")).toMatch(/^games\/g1\/[0-9a-f-]{36}$/);
  });

  it("never repeats a key", () => {
    expect(newImageKey("g1")).not.toBe(newImageKey("g1"));
  });
});

describe("createUploadUrl", () => {
  it("signs a PUT against the private bucket with a 15-minute expiry", async () => {
    const { uploadUrl, imageKey } = await createUploadUrl("g1", "image/png", 1024);
    const url = new URL(uploadUrl);

    expect(url.pathname).toContain(imageKey);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(UPLOAD_URL_TTL_SECONDS));
    expect(UPLOAD_URL_TTL_SECONDS).toBe(900);
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("makes the content type and length conditions of the signature", async () => {
    const { uploadUrl } = await createUploadUrl("g1", "image/png", 1024);
    const signed = new URL(uploadUrl).searchParams.get("X-Amz-SignedHeaders") ?? "";
    expect(signed).toContain("content-type");
    expect(signed).toContain("content-length");
  });

  it("accepts every allowed image type", async () => {
    for (const contentType of ALLOWED_CONTENT_TYPES) {
      await expect(createUploadUrl("g1", contentType, 1024)).resolves.toBeDefined();
    }
  });

  it("refuses a type that is not an allowed image", async () => {
    await expect(createUploadUrl("g1", "application/pdf", 1024)).rejects.toThrow(ValidationError);
    await expect(createUploadUrl("g1", "image/svg+xml", 1024)).rejects.toThrow(
      /not an allowed image type/,
    );
  });

  it("caps the upload at 10 MB", async () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    await expect(createUploadUrl("g1", "image/png", MAX_IMAGE_BYTES)).resolves.toBeDefined();
    await expect(createUploadUrl("g1", "image/png", MAX_IMAGE_BYTES + 1)).rejects.toThrow(
      /at most 10485760 bytes/,
    );
  });

  it("refuses a zero or fractional length", async () => {
    await expect(createUploadUrl("g1", "image/png", 0)).rejects.toThrow(/positive integer/);
    await expect(createUploadUrl("g1", "image/png", 1.5)).rejects.toThrow(/positive integer/);
  });
});

describe("createViewUrl", () => {
  it("signs a GET with a one-hour expiry", async () => {
    const url = new URL(await createViewUrl("games/g1/abc"));
    expect(url.pathname).toContain("games/g1/abc");
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(VIEW_URL_TTL_SECONDS));
    expect(VIEW_URL_TTL_SECONDS).toBe(3600);
  });
});

describe("signRounds", () => {
  it("replaces the storage key with a usable URL", async () => {
    const [signed] = await signRounds([round([question(1, "games/g1/bird.png")])]);
    expect(signed.questions[0].imageUrl).toContain("games/g1/bird.png");
    expect(signed.questions[0]).not.toHaveProperty("imageKey");
  });

  it("gives a text question a null imageUrl", async () => {
    const [signed] = await signRounds([round([question(1)])]);
    expect(signed.questions[0].imageUrl).toBeNull();
    expect(signed.questions[0].text).toBe("Q1");
  });

  it("signs a repeated key once and reuses it", async () => {
    const [signed] = await signRounds([
      round([question(1, "games/g1/same.png"), question(2, "games/g1/same.png")]),
    ]);
    expect(signed.questions[0].imageUrl).toBe(signed.questions[1].imageUrl);
  });

  it("keeps the rest of the round untouched", async () => {
    const [signed] = await signRounds([round([question(1, "games/g1/a.png")])]);
    expect(signed).toMatchObject({ number: 1, category: "Birds", status: "ACTIVE", releasedCount: 2 });
  });

  it("needs no bucket when there is nothing to sign", async () => {
    delete process.env.IMAGES_BUCKET;
    const [signed] = await signRounds([round([question(1)])]);
    expect(signed.questions[0].imageUrl).toBeNull();
  });
});
