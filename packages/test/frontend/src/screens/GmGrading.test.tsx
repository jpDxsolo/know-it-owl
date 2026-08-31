import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@know-it-owl/frontend/hooks/useGame";
import { GmGrading } from "@know-it-owl/frontend/screens/GmGrading";
import { setApiConfig } from "@know-it-owl/frontend/services/config";
import { setGmToken } from "@know-it-owl/frontend/services/identity";

class InertSocket {
  onopen: (() => void) | undefined;
  onmessage: ((event: MessageEvent<string>) => void) | undefined;
  onclose: (() => void) | undefined;
  onerror: (() => void) | undefined;
  readyState = 0;
  send(): void {}
  close(): void {}
}

let calls: { query: string; variables: Record<string, unknown> }[] = [];

function player(id: string, displayName: string, teamId: string | null = null) {
  return { id, displayName, teamId };
}

function team(id: string, name: string, members: ReturnType<typeof player>[]) {
  return {
    id,
    name,
    score: 0,
    doubleUsedRound: null,
    lastSubmittedRound: 1,
    players: members,
  };
}

const ada = player("p1", "Ada", "t1");
const grace = player("p2", "Grace", "t2");

const game: Game = {
  id: "g1",
  joinCode: "ABC123",
  status: "GRADING",
  currentRound: 1,
  players: [ada, grace],
  teams: [team("t1", "Owls", [ada]), team("t2", "Bears", [grace])],
  rounds: [],
};

function textQuestion(number: number) {
  return {
    number,
    type: "TEXT" as const,
    text: `Question ${number}?`,
    imageUrl: null,
    defaultPoints: 2,
    correctAnswers: ["Canberra"],
  };
}

function pictureQuestion(number: number) {
  return {
    number,
    type: "PICTURE_10" as const,
    text: null,
    imageUrl: "https://images.test/one.jpg",
    defaultPoints: 1,
    correctAnswers: Array.from({ length: 10 }, (_, index) => `Thing ${index + 1}`),
  };
}

function response(
  questionNumber: number,
  teamId: string,
  answers: string[],
  overrides: { doubled?: boolean; gradedPoints?: number[] | null } = {},
) {
  return {
    roundNumber: 1,
    questionNumber,
    teamId,
    answers,
    doubled: overrides.doubled ?? false,
    graded: overrides.gradedPoints != null,
    gradedPoints: overrides.gradedPoints ?? null,
  };
}

type Question = ReturnType<typeof textQuestion> | ReturnType<typeof pictureQuestion>;

function results(questions: Question[], responses: ReturnType<typeof response>[]) {
  return {
    round: {
      number: 1,
      category: "Capitals",
      status: "GRADING",
      releasedCount: questions.length,
      questionCount: questions.length,
      questions,
    },
    responses,
    standings: game.teams,
  };
}

function serve(payload: ReturnType<typeof results>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      calls.push(body);
      if (body.query.includes("query RoundResults")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { roundResults: payload } }),
        };
      }
      if (body.query.includes("query Game")) {
        return { ok: true, status: 200, json: async () => ({ data: { game } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: { gradeResponse: null } }) };
    }),
  );
}

/** Reports wherever the router currently is, so a redirect can be asserted. */
function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderGrading() {
  return render(
    <MemoryRouter initialEntries={["/game/g1/gm/grading"]}>
      <Location />
      <Routes>
        <Route path="/game/:gameId/gm/grading" element={<GmGrading />} />
        <Route path="/game/:gameId/gm" element={<p>dashboard</p>} />
        <Route path="/game/:gameId/reveal" element={<p>reveal</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const oneTextQuestion = () =>
  results(
    [textQuestion(1)],
    [response(1, "t1", ["Canberra"]), response(1, "t2", ["Sydney"])],
  );

beforeEach(() => {
  calls = [];
  localStorage.clear();
  setApiConfig({ url: "https://api.test/graphql", realtimeUrl: "wss://rt.test", apiKey: "da2-x" });
  vi.stubGlobal("WebSocket", InertSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setApiConfig(undefined);
  localStorage.clear();
});

describe("getting here at all", () => {
  it("stays put while the round is still active", async () => {
    // Nothing is marked yet, so the game is still ROUND_ACTIVE — and marking is
    // what moves it to GRADING. Redirecting on that status would bounce the host
    // back to the dashboard, which is the only route here: a deadlock in which
    // the round can only ever be revealed unmarked.
    setGmToken("g1", "token");
    const active: Game = { ...game, status: "ROUND_ACTIVE" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { query: string };
        if (body.query.includes("query RoundResults")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { roundResults: oneTextQuestion() } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: { game: active } }) };
      }),
    );
    renderGrading();

    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent("/game/g1/gm/grading");
  });

  it("leaves once the round has been revealed", async () => {
    setGmToken("g1", "token");
    const revealed: Game = { ...game, status: "REVEAL" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { query: string };
        if (body.query.includes("query RoundResults")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { roundResults: oneTextQuestion() } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: { game: revealed } }) };
      }),
    );
    renderGrading();

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/game/g1/reveal"),
    );
  });
});

describe("who is allowed in", () => {
  it("refuses a browser with no host key", async () => {
    serve(oneTextQuestion());
    renderGrading();
    expect(screen.getByText(/not your game to run/i)).toBeInTheDocument();
  });
});

describe("the marking sheet", () => {
  it("puts every team's answer against the key", async () => {
    setGmToken("g1", "token");
    serve(oneTextQuestion());
    renderGrading();

    await waitFor(() => expect(screen.getByText(/marking round 1 · capitals/i)).toBeInTheDocument());
    expect(screen.getByText("Question 1?")).toBeInTheDocument();
    // Once as the answer key, once as what the Owls wrote.
    expect(screen.getAllByText("Canberra")).toHaveLength(2);
    expect(screen.getByText("Sydney")).toBeInTheDocument();
    expect(screen.getByText("Owls")).toBeInTheDocument();
    expect(screen.getByText("Bears")).toBeInTheDocument();
  });

  it("counts what is left to mark", async () => {
    setGmToken("g1", "token");
    serve(
      results(
        [textQuestion(1)],
        [
          response(1, "t1", ["Canberra"], { gradedPoints: [2] }),
          response(1, "t2", ["Sydney"]),
        ],
      ),
    );
    renderGrading();

    await waitFor(() => expect(screen.getByText(/1 of 2 marked/i)).toBeInTheDocument());
    expect(screen.getByText(/1 answer is still unmarked/i)).toBeInTheDocument();
  });

  it("shows points already entered, and leaves an unmarked box empty", async () => {
    setGmToken("g1", "token");
    serve(
      results(
        [textQuestion(1)],
        [
          response(1, "t1", ["Canberra"], { gradedPoints: [2] }),
          response(1, "t2", ["Sydney"]),
        ],
      ),
    );
    renderGrading();

    await waitFor(() =>
      expect(screen.getByLabelText("Points for Owls")).toHaveValue(2),
    );
    expect(screen.getByLabelText("Points for Bears")).toHaveValue(null);
  });

  it("says so when a team handed in nothing for a question", async () => {
    setGmToken("g1", "token");
    serve(results([textQuestion(1)], [response(1, "t1", ["Canberra"])]));
    renderGrading();

    await waitFor(() => expect(screen.getByText(/nothing handed in/i)).toBeInTheDocument());
  });
});

describe("entering points", () => {
  it("sends exactly what was typed, to the right team and question", async () => {
    setGmToken("g1", "token");
    serve(oneTextQuestion());
    renderGrading();
    await waitFor(() => expect(screen.getByLabelText("Points for Bears")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Points for Bears"), "1");
    await userEvent.tab();

    await waitFor(() => expect(calls.some((c) => c.query.includes("GradeResponse"))).toBe(true));
    expect(calls.find((c) => c.query.includes("GradeResponse"))?.variables.input).toEqual({
      gameId: "g1",
      gmToken: "token",
      roundNumber: 1,
      questionNumber: 1,
      teamId: "t2",
      points: [1],
    });
  });

  it("does not multiply a doubled team's number — the typed value is final", async () => {
    setGmToken("g1", "token");
    serve(
      results(
        [textQuestion(1)],
        [response(1, "t1", ["Canberra"], { doubled: true }), response(1, "t2", ["Sydney"])],
      ),
    );
    renderGrading();
    await waitFor(() => expect(screen.getByLabelText("Points for Owls")).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText("Points for Owls"), "4");
    await userEvent.tab();

    await waitFor(() => expect(calls.some((c) => c.query.includes("GradeResponse"))).toBe(true));
    const sent = calls.find((c) => c.query.includes("GradeResponse"))?.variables.input as {
      points: number[];
    };
    expect(sent.points).toEqual([4]);
  });

  it("marks a whole answer right in one tap, at the question's own value", async () => {
    setGmToken("g1", "token");
    serve(oneTextQuestion());
    renderGrading();
    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());

    const row = screen.getByLabelText("Points for Owls").closest("li");
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: "Full" }));

    await waitFor(() => expect(calls.some((c) => c.query.includes("GradeResponse"))).toBe(true));
    const sent = calls.find((c) => c.query.includes("GradeResponse"))?.variables.input as {
      points: number[];
      teamId: string;
    };
    expect(sent).toMatchObject({ teamId: "t1", points: [2] });
  });

  it("gives a picture round one box per item", async () => {
    setGmToken("g1", "token");
    serve(
      results(
        [pictureQuestion(1)],
        [
          response(
            1,
            "t1",
            Array.from({ length: 10 }, (_, index) => `Guess ${index + 1}`),
          ),
        ],
      ),
    );
    renderGrading();

    await waitFor(() =>
      expect(screen.getByLabelText("Points for Owls, item 1")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Points for Owls, item 10")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All right" }));
    await waitFor(() => expect(calls.some((c) => c.query.includes("GradeResponse"))).toBe(true));
    const sent = calls.find((c) => c.query.includes("GradeResponse"))?.variables.input as {
      points: number[];
    };
    expect(sent.points).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("reports a refusal rather than losing it", async () => {
    setGmToken("g1", "token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { query: string };
        if (body.query.includes("query RoundResults")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { roundResults: oneTextQuestion() } }),
          };
        }
        if (body.query.includes("query Game")) {
          return { ok: true, status: 200, json: async () => ({ data: { game } }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            errors: [
              { message: "Round 1 is no longer being graded", errorType: "ConflictError" },
            ],
          }),
        };
      }),
    );
    renderGrading();
    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());

    const row = screen.getByLabelText("Points for Owls").closest("li");
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: "Full" }));

    await waitFor(() =>
      expect(screen.getByText(/no longer being graded/i)).toBeInTheDocument(),
    );
  });
});

describe("the doubled badge", () => {
  it("is impossible to miss, and says the host has to type the doubled value", async () => {
    setGmToken("g1", "token");
    serve(
      results(
        [textQuestion(1)],
        [response(1, "t1", ["Canberra"], { doubled: true }), response(1, "t2", ["Sydney"])],
      ),
    );
    renderGrading();

    await waitFor(() => expect(screen.getByText("DOUBLED ×2")).toBeInTheDocument());
    expect(screen.getByText(/nothing is multiplied for you/i)).toBeInTheDocument();
  });

  it("is absent for a team that did not double", async () => {
    setGmToken("g1", "token");
    serve(oneTextQuestion());
    renderGrading();

    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());
    expect(screen.queryByText("DOUBLED ×2")).not.toBeInTheDocument();
  });
});

describe("finishing the round", () => {
  it("will not reveal while an answer is unmarked", async () => {
    // An unmarked answer silently scores nothing, and a reveal is the moment
    // the scores become the standings — so the host has to say what every
    // answer was worth first, even when the answer is worth nought.
    setGmToken("g1", "token");
    serve(oneTextQuestion());
    renderGrading();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /end round and reveal/i })).toBeDisabled(),
    );
    expect(screen.getByText(/2 answers are still unmarked/i)).toBeInTheDocument();
  });

  it("reveals the round once everything is marked", async () => {
    setGmToken("g1", "token");
    serve(
      results(
        [textQuestion(1)],
        [
          response(1, "t1", ["Canberra"], { gradedPoints: [2] }),
          response(1, "t2", ["Sydney"], { gradedPoints: [0] }),
        ],
      ),
    );
    renderGrading();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /end round and reveal/i })).toBeEnabled(),
    );
    expect(screen.getByText(/everything is marked/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /end round and reveal/i }));
    await waitFor(() => expect(calls.some((c) => c.query.includes("EndRound"))).toBe(true));
    expect(calls.find((c) => c.query.includes("EndRound"))?.variables).toEqual({
      gameId: "g1",
      gmToken: "token",
      roundNumber: 1,
    });
  });
});

describe("marking a whole question", () => {
  it("noughts only the answers still unmarked, leaving entered scores alone", async () => {
    setGmToken("g1", "token");
    serve(
      results(
        [textQuestion(1)],
        [
          response(1, "t1", ["Canberra"], { gradedPoints: [2] }),
          response(1, "t2", ["Sydney"]),
        ],
      ),
    );
    renderGrading();
    await waitFor(() => expect(screen.getByText("Sydney")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /nought the rest/i }));

    await waitFor(() => expect(calls.some((c) => c.query.includes("GradeResponse"))).toBe(true));
    const graded = calls.filter((c) => c.query.includes("GradeResponse"));
    // The Owls' 2 was already in; only the Bears are touched.
    expect(graded).toHaveLength(1);
    expect(graded[0].variables.input).toMatchObject({ teamId: "t2", points: [0] });
  });

  it("gives every team the marks in one go", async () => {
    setGmToken("g1", "token");
    serve(oneTextQuestion());
    renderGrading();
    await waitFor(() => expect(screen.getByText("Sydney")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /everyone right/i }));

    await waitFor(() =>
      expect(calls.filter((c) => c.query.includes("GradeResponse"))).toHaveLength(2),
    );
    const graded = calls.filter((c) => c.query.includes("GradeResponse"));
    expect(graded.map((c) => (c.variables.input as { teamId: string }).teamId)).toEqual([
      "t1",
      "t2",
    ]);
    expect(graded.every((c) => (c.variables.input as { points: number[] }).points[0] === 2)).toBe(
      true,
    );
  });
});

describe("marking at speed", () => {
  it("moves Enter down the column of points boxes", async () => {
    // A host reads across a row, types a number, and wants the next box.
    setGmToken("g1", "token");
    serve(oneTextQuestion());
    renderGrading();
    await waitFor(() => expect(screen.getByLabelText("Points for Owls")).toBeInTheDocument());

    const first = screen.getByLabelText("Points for Owls");
    first.focus();
    await userEvent.keyboard("2{Enter}");

    expect(screen.getByLabelText("Points for Bears")).toHaveFocus();
    // Leaving the box is what saves it, so moving on has banked the 2.
    await waitFor(() => expect(calls.some((c) => c.query.includes("GradeResponse"))).toBe(true));
    expect(calls.find((c) => c.query.includes("GradeResponse"))?.variables.input).toMatchObject({
      teamId: "t1",
      points: [2],
    });
  });

  it("keeps the quick marks out of the tab path between boxes", async () => {
    setGmToken("g1", "token");
    serve(oneTextQuestion());
    renderGrading();
    await waitFor(() => expect(screen.getByLabelText("Points for Owls")).toBeInTheDocument());

    screen.getByLabelText("Points for Owls").focus();
    await userEvent.tab();

    expect(screen.getByLabelText("Points for Bears")).toHaveFocus();
  });
});
