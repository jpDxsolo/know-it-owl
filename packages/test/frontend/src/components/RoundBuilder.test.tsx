import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoundBuilder } from "@know-it-owl/frontend/components/RoundBuilder";
import { setApiConfig } from "@know-it-owl/frontend/services/config";

/** Every GraphQL call made, so a test can assert what was actually sent. */
let calls: { query: string; variables: Record<string, unknown> }[] = [];
let uploads: RequestInit[] = [];

function mockNetwork(options: { uploadStatus?: number; createFails?: string } = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      // The presigned PUT is not a GraphQL call.
      if (init.method === "PUT") {
        uploads.push(init);
        return { ok: (options.uploadStatus ?? 200) < 400, status: options.uploadStatus ?? 200 };
      }
      const body = JSON.parse(String(init.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      calls.push(body);
      if (body.query.includes("GetImageUploadUrl")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { getImageUploadUrl: { uploadUrl: "https://s3.test/put", imageKey: "games/g1/pic" } },
          }),
        };
      }
      if (options.createFails) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: null,
            errors: [{ errorType: "ValidationError", message: options.createFails }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { createRound: { number: 1 } } }),
      };
    }),
  );
}

const onSaved = vi.fn();
const onCancel = vi.fn();

function renderBuilder() {
  return render(
    <RoundBuilder
      gameId="g1"
      gmToken="token"
      roundNumber={1}
      onSaved={onSaved}
      onCancel={onCancel}
    />,
  );
}

/** A file of a given type and size, without allocating the bytes. */
function file(name: string, type: string, size = 1024): File {
  const made = new File(["x"], name, { type });
  Object.defineProperty(made, "size", { value: size });
  return made;
}

beforeEach(() => {
  calls = [];
  uploads = [];
  // jsdom has no object URLs, and the builder makes one to preview the upload.
  vi.stubGlobal("URL", Object.assign(globalThis.URL, { createObjectURL: () => "blob:preview" }));
  setApiConfig({ url: "https://api.test/graphql", realtimeUrl: "wss://rt.test", apiKey: "da2-x" });
  mockNetwork();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setApiConfig(undefined);
});

describe("writing a text question", () => {
  it("sends the round with its category and answer", async () => {
    renderBuilder();
    await userEvent.type(screen.getByLabelText(/category/i), "90s Music");
    await userEvent.type(screen.getByLabelText(/^question$/i), "Which band released Nevermind?");
    await userEvent.type(screen.getByLabelText(/^answer$/i), "Nirvana");
    await userEvent.click(screen.getByRole("button", { name: /save round/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const create = calls.find((call) => call.query.includes("CreateRound"));
    expect(create?.variables).toEqual({
      gameId: "g1",
      gmToken: "token",
      category: "90s Music",
      questions: [
        {
          type: "TEXT",
          text: "Which band released Nevermind?",
          correctAnswers: ["Nirvana"],
          defaultPoints: 1,
        },
      ],
    });
  });

  it("trims what the host typed, the way the server will", async () => {
    renderBuilder();
    await userEvent.type(screen.getByLabelText(/category/i), "  Capitals  ");
    await userEvent.type(screen.getByLabelText(/^question$/i), "  Capital of Peru?  ");
    await userEvent.type(screen.getByLabelText(/^answer$/i), "  Lima  ");
    await userEvent.click(screen.getByRole("button", { name: /save round/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const create = calls.find((call) => call.query.includes("CreateRound"));
    expect(create?.variables.category).toBe("Capitals");
    expect(create?.variables.questions).toEqual([
      { type: "TEXT", text: "Capital of Peru?", correctAnswers: ["Lima"], defaultPoints: 1 },
    ]);
  });
});

describe("validation", () => {
  it("says nothing until the host actually tries to save", () => {
    // Marking a half-typed question as wrong is nagging, not helping.
    renderBuilder();
    expect(screen.queryByText(/add the question/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).not.toHaveAttribute("aria-invalid", "true");
  });

  it("refuses an empty round and points at what is missing", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: /save round/i }));

    expect(screen.getByText(/give the round a category/i)).toBeInTheDocument();
    expect(screen.getByText(/add the question/i)).toBeInTheDocument();
    expect(calls.some((call) => call.query.includes("CreateRound"))).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("wants an answer as well as a question", async () => {
    renderBuilder();
    await userEvent.type(screen.getByLabelText(/category/i), "Capitals");
    await userEvent.type(screen.getByLabelText(/^question$/i), "Capital of Peru?");
    await userEvent.click(screen.getByRole("button", { name: /save round/i }));

    expect(screen.getByText(/add an answer/i)).toBeInTheDocument();
    expect(calls.some((call) => call.query.includes("CreateRound"))).toBe(false);
  });

  it("surfaces the server's own refusal", async () => {
    mockNetwork({ createFails: "A round needs at least one question" });
    renderBuilder();
    await userEvent.type(screen.getByLabelText(/category/i), "Capitals");
    await userEvent.type(screen.getByLabelText(/^question$/i), "Capital of Peru?");
    await userEvent.type(screen.getByLabelText(/^answer$/i), "Lima");
    await userEvent.click(screen.getByRole("button", { name: /save round/i }));

    await waitFor(() =>
      expect(screen.getByText(/needs at least one question/i)).toBeInTheDocument(),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("picture questions", () => {
  async function switchToPicture(): Promise<void> {
    await userEvent.click(screen.getByRole("button", { name: /picture \(10\)/i }));
  }

  it("asks for exactly ten answers, because that is what the round is", async () => {
    renderBuilder();
    await switchToPicture();

    for (let number = 1; number <= 10; number += 1) {
      expect(screen.getByLabelText(`Answer ${number}`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Answer 11")).not.toBeInTheDocument();
    // One image, not ten.
    expect(screen.getByText(/one image, ten numbered things/i)).toBeInTheDocument();
  });

  it("will not save without the picture", async () => {
    renderBuilder();
    await userEvent.type(screen.getByLabelText(/category/i), "Faces");
    await switchToPicture();
    await userEvent.click(screen.getByRole("button", { name: /save round/i }));

    expect(screen.getByText(/add the picture/i)).toBeInTheDocument();
  });

  it("counts how many answers are still empty", async () => {
    renderBuilder();
    await userEvent.type(screen.getByLabelText(/category/i), "Faces");
    await switchToPicture();
    await userEvent.upload(screen.getByLabelText(/choose picture/i), file("a.png", "image/png"));
    await waitFor(() => expect(screen.getByText(/^Replace$/)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Answer 1"), "Freddie Mercury");
    await userEvent.click(screen.getByRole("button", { name: /save round/i }));

    expect(screen.getByText(/9 still empty/i)).toBeInTheDocument();
  });

  it("uploads the image and sends its key with ten answers", async () => {
    renderBuilder();
    await userEvent.type(screen.getByLabelText(/category/i), "Faces");
    await switchToPicture();
    await userEvent.upload(screen.getByLabelText(/choose picture/i), file("a.png", "image/png", 2048));
    await waitFor(() => expect(screen.getByText(/^Replace$/)).toBeInTheDocument());

    for (let number = 1; number <= 10; number += 1) {
      await userEvent.type(screen.getByLabelText(`Answer ${number}`), `Face ${number}`);
    }
    await userEvent.click(screen.getByRole("button", { name: /save round/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    // The URL is signed for one exact type and length, so both must be asked for.
    const signing = calls.find((call) => call.query.includes("GetImageUploadUrl"));
    expect(signing?.variables).toMatchObject({ contentType: "image/png", contentLength: 2048 });
    // And the PUT must not contradict the type it was signed with.
    expect((uploads[0]?.headers as Record<string, string>)["Content-Type"]).toBe("image/png");

    const create = calls.find((call) => call.query.includes("CreateRound"));
    expect(create?.variables.questions).toEqual([
      {
        type: "PICTURE_10",
        imageKey: "games/g1/pic",
        correctAnswers: Array.from({ length: 10 }, (_, i) => `Face ${i + 1}`),
        defaultPoints: 1,
      },
    ]);
  });

  it("rejects a file that is not an image before uploading anything", async () => {
    renderBuilder();
    await switchToPicture();
    await userEvent.upload(
      screen.getByLabelText(/choose picture/i),
      file("notes.pdf", "application/pdf"),
      // `accept` already blocks this in a real picker; bypass it so the guard
      // behind it is exercised too.
      { applyAccept: false },
    );

    await waitFor(() => expect(screen.getByText(/isn't an image we can use/i)).toBeInTheDocument());
    expect(calls.some((call) => call.query.includes("GetImageUploadUrl"))).toBe(false);
  });

  it("rejects an oversized image with its actual size", async () => {
    renderBuilder();
    await switchToPicture();
    await userEvent.upload(
      screen.getByLabelText(/choose picture/i),
      file("huge.png", "image/png", 12 * 1024 * 1024),
    );

    await waitFor(() => expect(screen.getByText(/12MB/i)).toBeInTheDocument());
    expect(calls.some((call) => call.query.includes("GetImageUploadUrl"))).toBe(false);
  });

  it("explains a refused upload rather than leaving it stuck", async () => {
    mockNetwork({ uploadStatus: 403 });
    renderBuilder();
    await switchToPicture();
    await userEvent.upload(screen.getByLabelText(/choose picture/i), file("a.png", "image/png"));

    await waitFor(() => expect(screen.getByText(/upload was refused \(403\)/i)).toBeInTheDocument());
    // Still offering to pick, rather than stuck on "Uploading…".
    expect(screen.getByText(/^Choose picture$/)).toBeInTheDocument();
    expect(screen.getByLabelText(/choose picture/i)).toBeEnabled();
  });

  it("rebuilds the answer key when the type changes", async () => {
    // One answer and ten numbered ones are not the same list half-filled.
    renderBuilder();
    await userEvent.type(screen.getByLabelText(/^answer$/i), "Nirvana");
    await switchToPicture();
    expect(screen.getByLabelText("Answer 1")).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: /^text$/i }));
    expect(screen.getByLabelText(/^answer$/i)).toHaveValue("");
  });
});

describe("managing the question list", () => {
  it("starts with one question and cannot remove the last one", () => {
    renderBuilder();
    expect(screen.getAllByRole("group", { name: /question \d+ type/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("adds and removes questions", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: /add question/i }));
    expect(screen.getAllByRole("group", { name: /question \d+ type/i })).toHaveLength(2);
    expect(screen.getByText(/^2 questions$/i)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);
    expect(screen.getAllByRole("group", { name: /question \d+ type/i })).toHaveLength(1);
  });

  it("keeps each question's own type when several are open", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: /add question/i }));
    const cards = screen.getAllByRole("listitem");
    await userEvent.click(within(cards[1]).getByRole("button", { name: /picture \(10\)/i }));

    expect(within(cards[0]).getByLabelText(/^answer$/i)).toBeInTheDocument();
    expect(within(cards[1]).getByLabelText("Answer 10")).toBeInTheDocument();
  });

  it("cancels without saving", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(calls.some((call) => call.query.includes("CreateRound"))).toBe(false);
  });
});
