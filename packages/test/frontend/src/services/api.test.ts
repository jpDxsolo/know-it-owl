import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ChooseDoubleMutation,
  CreateGameMutation,
  EndRoundMutation,
  execute,
  GameQuery,
  JoinGameMutation,
  OnGameUpdatedSubscription,
  RandomizeTeamsMutation,
  ReleaseQuestionMutation,
  SetTeamNameMutation,
  StartRoundMutation,
  SubmitAnswersMutation,
} from "@know-it-owl/frontend/services/api";
import { setApiConfig } from "@know-it-owl/frontend/services/config";

const URL = "https://example.test/graphql";

/** Reply to the next fetch with a body, as AppSync would. */
function replyWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: async () => body,
    }),
  );
}

beforeEach(() => {
  setApiConfig({ url: URL, realtimeUrl: "wss://example.test/graphql", apiKey: "da2-test" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setApiConfig(undefined);
});

describe("execute", () => {
  it("posts the operation with the api key and returns data", async () => {
    replyWith({ data: { standings: [] } });
    const result = await execute(GameQuery, { gameId: "g1", gmToken: null });

    expect(result).toEqual({ standings: [] });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(URL);
    const request = init as RequestInit;
    expect((request.headers as Record<string, string>)["x-api-key"]).toBe("da2-test");
    const body = JSON.parse(String(request.body)) as { query: string; variables: unknown };
    expect(body.query).toContain("query Game");
    expect(body.variables).toEqual({ gameId: "g1", gmToken: null });
  });

  it("sends an empty variables object when there are none", async () => {
    replyWith({ data: { createGame: { gmToken: "t", game: null } } });
    await execute(CreateGameMutation);

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body)) as { variables: unknown };
    expect(body.variables).toEqual({});
  });
});

describe("error mapping", () => {
  // AppSync reports the *class name* the Lambda threw; the `code` field on the
  // error class does not survive the boundary. These names are the contract.
  it.each([
    ["NotFoundError", "NOT_FOUND"],
    ["ForbiddenError", "FORBIDDEN"],
    ["ValidationError", "VALIDATION"],
    ["ConflictError", "CONFLICT"],
    ["UnauthorizedException", "UNAUTHORIZED"],
  ])("maps %s to %s", async (errorType, code) => {
    replyWith({ data: null, errors: [{ errorType, message: "nope" }] });

    const error = await execute(GameQuery, { gameId: "g1", gmToken: null }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    expect((error as ApiError).message).toBe("nope");
    expect((error as ApiError).isTransient).toBe(false);
  });

  it("falls back to UNKNOWN but keeps the raw errorType for logging", async () => {
    replyWith({ data: null, errors: [{ errorType: "SomethingNew", message: "?" }] });

    const error = (await execute(GameQuery, { gameId: "g1", gmToken: null }).catch(
      (caught: unknown) => caught,
    )) as ApiError;
    expect(error.code).toBe("UNKNOWN");
    expect(error.errorType).toBe("SomethingNew");
  });

  it("prefers the error over partial data", async () => {
    // AppSync returns both when one field of several fails.
    replyWith({ data: { game: null }, errors: [{ errorType: "ConflictError", message: "busy" }] });

    const error = (await execute(GameQuery, { gameId: "g1", gmToken: null }).catch(
      (caught: unknown) => caught,
    )) as ApiError;
    expect(error.code).toBe("CONFLICT");
  });

  it("treats a thrown fetch as transient", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = (await execute(GameQuery, { gameId: "g1", gmToken: null }).catch(
      (caught: unknown) => caught,
    )) as ApiError;
    expect(error.code).toBe("NETWORK");
    expect(error.isTransient).toBe(true);
  });

  it("treats a 5xx as transient without parsing it", async () => {
    replyWith("<html>gateway timeout</html>", 504);

    const error = (await execute(GameQuery, { gameId: "g1", gmToken: null }).catch(
      (caught: unknown) => caught,
    )) as ApiError;
    expect(error.code).toBe("NETWORK");
  });

  it("reports an unreadable body rather than throwing a SyntaxError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      }),
    );

    const error = (await execute(GameQuery, { gameId: "g1", gmToken: null }).catch(
      (caught: unknown) => caught,
    )) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("NETWORK");
  });

  it("rejects a response with neither data nor errors", async () => {
    replyWith({});
    await expect(execute(GameQuery, { gameId: "g1", gmToken: null })).rejects.toThrow(ApiError);
  });
});

describe("fan-out selections", () => {
  /**
   * AppSync delivers a subscriber only the fields the *mutation* selected, and
   * matches the gameId filter against the mutation's own response — so a
   * fan-out mutation that selects less than the subscription silently delivers
   * a half-empty event, and one that omits gameId delivers nothing at all.
   * Sharing one fragment is what prevents that; this is what stops someone
   * inlining or trimming a selection later and breaking it invisibly.
   *
   * The list mirrors the @aws_subscribe list in graphql/schema.graphql.
   */
  const FAN_OUT_MUTATIONS = {
    joinGame: JoinGameMutation,
    randomizeTeams: RandomizeTeamsMutation,
    setTeamName: SetTeamNameMutation,
    startRound: StartRoundMutation,
    releaseQuestion: ReleaseQuestionMutation,
    chooseDouble: ChooseDoubleMutation,
    submitAnswers: SubmitAnswersMutation,
    endRound: EndRoundMutation,
  };

  /** The fragment definitions in a document, keyed by name. */
  function fragments(document: string): Map<string, string> {
    const found = new Map<string, string>();
    const pattern = /fragment (\w+) on \w+ \{([\s\S]*?)\n\}/g;
    for (const [, name, body] of document.matchAll(pattern)) {
      found.set(name, body.replace(/\s+/g, " ").trim());
    }
    return found;
  }

  const subscription = OnGameUpdatedSubscription.toString();

  it("the subscription carries both fragments", () => {
    const defined = fragments(subscription);
    expect([...defined.keys()].sort()).toEqual(["GameFields", "GameUpdateFields"]);
    expect(defined.get("GameUpdateFields")).toContain("gameId");
  });

  it.each(Object.entries(FAN_OUT_MUTATIONS))(
    "%s selects exactly what the subscription does",
    (name, document) => {
      const text = document.toString();
      expect(text, `${name} must spread the shared fragment`).toContain("...GameUpdateFields");

      // Byte-for-byte the same fragment bodies, so a subscriber can never
      // receive less from this mutation than it asked for.
      const mine = fragments(text);
      const theirs = fragments(subscription);
      expect(mine.get("GameUpdateFields")).toBe(theirs.get("GameUpdateFields"));
      expect(mine.get("GameFields")).toBe(theirs.get("GameFields"));
    },
  );

  it("createGame is not in the fan-out list and needs no gameId", () => {
    // A negative case, so the assertions above are known to discriminate.
    expect(CreateGameMutation.toString()).not.toContain("GameUpdateFields");
  });
});
