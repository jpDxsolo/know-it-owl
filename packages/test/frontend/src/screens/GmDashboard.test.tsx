import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Game } from "@know-it-owl/frontend/hooks/useGame";
import { GmDashboard } from "@know-it-owl/frontend/screens/GmDashboard";
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
  return { id, name, score: 0, doubleUsedRound: null, players: members };
}

function question(number: number, text = `Question ${number}`) {
  return {
    number,
    type: "TEXT" as const,
    text,
    imageUrl: null,
    defaultPoints: 1,
    correctAnswers: null,
  };
}

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: "g1",
    joinCode: "ABC123",
    status: "LOBBY",
    currentRound: null,
    players: [],
    teams: [],
    rounds: [],
    ...overrides,
  };
}

/** Serve a game, plus optional roundResults for submission tracking. */
function serve(snapshot: Game, submittedTeamIds: string[] = []): void {
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
          json: async () => ({
            data: {
              roundResults: {
                round: null,
                responses: submittedTeamIds.map((teamId) => ({
                  roundNumber: 1,
                  questionNumber: 1,
                  teamId,
                  answers: ["x"],
                  doubled: false,
                  graded: false,
                  gradedPoints: null,
                })),
                standings: [],
              },
            },
          }),
        };
      }
      if (body.query.includes("query Game")) {
        return { ok: true, status: 200, json: async () => ({ data: { game: snapshot } }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    }),
  );
}

/** Reports wherever the router currently is, so a navigation can be asserted. */
function Location() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderDashboard(state?: { justCreated?: boolean; tieBreaker?: boolean }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/game/g1/gm", state }]}>
      <Location />
      <Routes>
        <Route path="/game/:gameId/gm" element={<GmDashboard />} />
        <Route path="/game/:gameId/gm/grading" element={<p>marking sheet</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

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

describe("who is allowed in", () => {
  it("refuses a browser with no host key, and explains why", async () => {
    // Deep-linking the dashboard without the token is not a bug to fix but a
    // fact to explain: the key never leaves the browser that made the game.
    serve(game());
    renderDashboard();

    expect(screen.getByText(/not your game to run/i)).toBeInTheDocument();
    expect(screen.getByText(/never leaves it/i)).toBeInTheDocument();
    expect(screen.queryByText("ABC123")).not.toBeInTheDocument();
  });

  it("does not even ask the server for a game it cannot run", async () => {
    // No token means no dashboard, so a query and a websocket would both be
    // work done for a screen that is about to refuse.
    serve(game());
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/not your game to run/i)).toBeInTheDocument());
    expect(calls.some((call) => call.query.includes("query Game"))).toBe(false);
  });

  it("lets the host in", async () => {
    setGmToken("g1", "token");
    serve(game());
    renderDashboard();
    await waitFor(() => expect(screen.getByText("ABC123")).toBeInTheDocument());
  });
});

describe("the one-time host notice", () => {
  it("appears only for a game just created in this tab", async () => {
    setGmToken("g1", "token");
    serve(game());
    renderDashboard({ justCreated: true });

    await waitFor(() => expect(screen.getByText(/this browser is now the host/i)).toBeInTheDocument());
    expect(screen.getByText(/send you another one/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.queryByText(/this browser is now the host/i)).not.toBeInTheDocument();
  });

  it("does not nag on an ordinary visit", async () => {
    setGmToken("g1", "token");
    serve(game());
    renderDashboard();
    await waitFor(() => expect(screen.getByText("ABC123")).toBeInTheDocument());
    expect(screen.queryByText(/this browser is now the host/i)).not.toBeInTheDocument();
  });
});

describe("before the teams are drawn", () => {
  it("shows the code and who has arrived", async () => {
    setGmToken("g1", "token");
    serve(game({ players: [player("p1", "Ada"), player("p2", "Grace")] }));
    renderDashboard();

    await waitFor(() => expect(screen.getByText("ABC123")).toBeInTheDocument());
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("2 players")).toBeInTheDocument();
  });

  it("draws a single team for a single player", async () => {
    setGmToken("g1", "token");
    serve(game({ players: [player("p1", "Ada")] }));
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /draw the teams/i })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: /draw the teams/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.query.includes("RandomizeTeams"))).toBe(true),
    );
    expect(calls.find((call) => call.query.includes("RandomizeTeams"))?.variables).toEqual({
      gameId: "g1",
      gmToken: "token",
      teamCount: 1,
    });
  });

  it("waits until somebody has actually joined", async () => {
    setGmToken("g1", "token");
    serve(game({ players: [] }));
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /draw the teams/i })).toBeDisabled(),
    );
    expect(screen.getByText(/waiting for someone to join/i)).toBeInTheDocument();
  });

  it("draws the teams with the chosen count", async () => {
    setGmToken("g1", "token");
    serve(game({ players: [player("p1", "Ada"), player("p2", "Grace")] }));
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /draw the teams/i }));
    await waitFor(() =>
      expect(calls.some((call) => call.query.includes("RandomizeTeams"))).toBe(true),
    );
    const draw = calls.find((call) => call.query.includes("RandomizeTeams"));
    expect(draw?.variables).toEqual({ gameId: "g1", gmToken: "token", teamCount: 2 });
  });

  it("will not start a round before the teams exist", async () => {
    setGmToken("g1", "token");
    serve(game({ players: [player("p1", "Ada"), player("p2", "Grace")] }));
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /start a round/i })).toBeDisabled();
    expect(screen.getByText(/draw the teams first/i)).toBeInTheDocument();
  });
});

describe("with teams but no rounds", () => {
  const seated = () =>
    game({
      status: "TEAMS_SET",
      players: [player("p1", "Ada", "t1"), player("p2", "Grace", "t2")],
      teams: [team("t1", "Owls", [player("p1", "Ada", "t1")]), team("t2", "Bears", [player("p2", "Grace", "t2")])],
    });

  it("says a round has to be written first", async () => {
    setGmToken("g1", "token");
    serve(seated());
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /start a round/i })).toBeDisabled();
    expect(screen.getByText(/write a round first/i)).toBeInTheDocument();
  });

  it("re-reads the game after a round is saved, so it can be started", async () => {
    // createRound fans out to nobody — it returns a Round, not a GameUpdate —
    // so without an explicit re-read the host's own new round is missing from
    // the list and the start button stays dead until a page reload.
    setGmToken("g1", "token");
    serve(seated());
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /new round/i }));
    await userEvent.type(screen.getByLabelText(/category/i), "Capitals");
    await userEvent.type(screen.getByLabelText(/^question$/i), "Capital of Australia?");
    await userEvent.type(screen.getByLabelText(/^answer$/i), "Canberra");

    const readsBefore = calls.filter((call) => call.query.includes("query Game")).length;
    await userEvent.click(screen.getByRole("button", { name: /save round/i }));

    await waitFor(() => expect(calls.some((call) => call.query.includes("CreateRound"))).toBe(true));
    await waitFor(() =>
      expect(calls.filter((call) => call.query.includes("query Game")).length).toBeGreaterThan(
        readsBefore,
      ),
    );
  });

  it("opens straight into a one-question tie-breaker when sent for one", async () => {
    // A tie-breaker is a round with a single question — same authoring, same
    // playing, same marking. The only difference is that it names itself and
    // will not grow a second question.
    setGmToken("g1", "token");
    serve(seated());
    renderDashboard({ tieBreaker: true });

    await waitFor(() => expect(screen.getByText("Tie-breaker")).toBeInTheDocument());
    expect(screen.getByLabelText(/category/i)).toHaveValue("Tie-breaker");
    expect(screen.queryByRole("button", { name: /add question/i })).not.toBeInTheDocument();
  });

  it("opens the round builder", async () => {
    setGmToken("g1", "token");
    serve(seated());
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /new round/i }));
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
  });

  it("offers to start once a round is written", async () => {
    setGmToken("g1", "token");
    serve({
      ...seated(),
      rounds: [
        {
          number: 1,
          category: "Capitals",
          status: "DRAFT",
          releasedCount: 0,
          questionCount: 1,
          doublingAllowed: true,
          questions: [question(1)],
        },
      ],
    });
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start round 1/i })).toBeEnabled(),
    );
    expect(screen.getByText(/round 1 · capitals/i)).toBeInTheDocument();
  });
});

describe("running a round", () => {
  const live = (releasedCount: number) =>
    game({
      status: "ROUND_ACTIVE",
      currentRound: 1,
      players: [player("p1", "Ada", "t1"), player("p2", "Grace", "t2")],
      teams: [team("t1", "Owls", [player("p1", "Ada", "t1")]), team("t2", "Bears", [player("p2", "Grace", "t2")])],
      rounds: [
        {
          number: 1,
          category: "Capitals",
          status: "ACTIVE",
          releasedCount,
          questionCount: 3,
          doublingAllowed: true,
          questions: [question(1), question(2), question(3)],
        },
      ],
    });

  it("offers exactly one next question — release is sequential", async () => {
    setGmToken("g1", "token");
    serve(live(1));
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/question 1 of 3 released/i)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /release next/i })).toHaveLength(1);
    expect(screen.getByText("Released")).toBeInTheDocument();
    expect(screen.getAllByText("Locked")).toHaveLength(1);
  });

  it("releases the next question by number", async () => {
    setGmToken("g1", "token");
    serve(live(1));
    renderDashboard();
    await waitFor(() => expect(screen.getByRole("button", { name: /release next/i })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: /release next/i }));
    await waitFor(() =>
      expect(calls.some((call) => call.query.includes("ReleaseQuestion"))).toBe(true),
    );
    expect(calls.find((call) => call.query.includes("ReleaseQuestion"))?.variables).toEqual({
      gameId: "g1",
      gmToken: "token",
      roundNumber: 1,
      questionNumber: 2,
    });
  });

  it("offers nothing to release once every question is out", async () => {
    setGmToken("g1", "token");
    serve(live(3));
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/question 3 of 3 released/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /release next/i })).not.toBeInTheDocument();
  });

  it("tracks who has handed in", async () => {
    setGmToken("g1", "token");
    serve(live(3), ["t1"]);
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/1 of 2 teams in/i)).toBeInTheDocument());
    expect(screen.getByText("Handed in")).toBeInTheDocument();
    expect(screen.getByText("Still writing")).toBeInTheDocument();
  });

  it("will not offer marking while a team is still writing", async () => {
    setGmToken("g1", "token");
    serve(live(3), ["t1"]);
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/1 of 2 teams in/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /mark the answers/i })).toBeDisabled();
    expect(screen.getByText(/every team has to hand in/i)).toBeInTheDocument();
  });

  it("goes to the marking sheet once everyone is in", async () => {
    // The only route there: the game does not reach GRADING until an answer is
    // marked, so a host with no way through from here could never mark at all.
    setGmToken("g1", "token");
    serve(live(3), ["t1", "t2"]);
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /mark the answers/i })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: /mark the answers/i }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent(
      "/game/g1/gm/grading",
    ));
  });

  it("never reveals a round straight from the dashboard, unmarked", async () => {
    // Revealing without marking scores every team nothing, and a revealed round
    // cannot be graded afterwards — so the reveal belongs on the marking sheet.
    setGmToken("g1", "token");
    serve(live(3), ["t1", "t2"]);
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /mark the answers/i })).toBeEnabled(),
    );
    expect(screen.queryByRole("button", { name: /reveal/i })).not.toBeInTheDocument();
    expect(calls.some((call) => call.query.includes("EndRound"))).toBe(false);
  });

  it("labels a picture question rather than showing empty text", async () => {
    setGmToken("g1", "token");
    const picture = live(1);
    picture.rounds[0].questions[1] = {
      number: 2,
      type: "PICTURE_10",
      text: null,
      imageUrl: null,
      defaultPoints: 1,
      correctAnswers: null,
    };
    serve(picture);
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Picture round")).toBeInTheDocument());
  });
});

describe("quiz files", () => {
  /** Teams drawn, no rounds written yet — where a quiz gets opened. */
  const seated = () =>
    game({
      status: "TEAMS_SET",
      players: [player("p1", "Ada", "t1"), player("p2", "Grace", "t2")],
      teams: [
        team("t1", "Owls", [player("p1", "Ada", "t1")]),
        team("t2", "Bears", [player("p2", "Grace", "t2")]),
      ],
    });

  /** A two-round quiz as it would arrive from disk. */
  const quiz = {
    knowItOwlQuiz: 1,
    name: "Tuesday",
    rounds: [
      {
        category: "Capitals",
        doublingAllowed: true,
        questions: [
          { type: "TEXT", text: "Capital of Australia?", correctAnswers: ["Canberra"], defaultPoints: 2 },
        ],
      },
      {
        category: "Picture round",
        doublingAllowed: false,
        questions: [
          {
            type: "PICTURE_10",
            imageKey: "games/old-game/pic",
            correctAnswers: Array.from({ length: 10 }, (_, i) => `Thing ${i + 1}`),
            defaultPoints: 1,
          },
        ],
      },
    ],
  };

  /** A File whose text() resolves to the given contents, as jsdom gives none. */
  function quizFile(contents: string): File {
    const made = new File([contents], "quiz.kio.json", { type: "application/json" });
    Object.defineProperty(made, "text", { value: async () => contents });
    return made;
  }

  it("creates every round in the file, in order", async () => {
    // createRound assigns the next number itself, so these cannot be fired
    // together — a quiz would come out shuffled by whichever landed first.
    setGmToken("g1", "token");
    serve(seated());
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());

    await userEvent.upload(
      screen.getByLabelText(/open a quiz file/i),
      quizFile(JSON.stringify(quiz)),
    );

    await waitFor(() =>
      expect(calls.filter((call) => call.query.includes("CreateRound"))).toHaveLength(2),
    );
    const created = calls.filter((call) => call.query.includes("CreateRound"));
    expect(created.map((call) => call.variables.category)).toEqual([
      "Capitals",
      "Picture round",
    ]);
    expect(created[1].variables.doublingAllowed).toBe(false);
    expect(created[1].variables.questions).toEqual([
      {
        type: "PICTURE_10",
        imageKey: "games/old-game/pic",
        correctAnswers: quiz.rounds[1].questions[0].correctAnswers,
        defaultPoints: 1,
      },
    ]);
  });

  it("explains a file that is not a quiz, and creates nothing", async () => {
    setGmToken("g1", "token");
    serve(seated());
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());

    await userEvent.upload(
      screen.getByLabelText(/open a quiz file/i),
      quizFile('{"hello":"world"}'),
    );

    await waitFor(() =>
      expect(screen.getByText(/wasn't written by know it owl/i)).toBeInTheDocument(),
    );
    expect(calls.some((call) => call.query.includes("CreateRound"))).toBe(false);
  });

  it("has nothing to save until a round exists", async () => {
    setGmToken("g1", "token");
    serve(seated());
    renderDashboard();

    await waitFor(() => expect(screen.getByText("Owls")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /save this quiz to a file/i })).toBeDisabled();
  });
});

describe("between rounds", () => {
  const revealed = () =>
    game({
      status: "REVEAL",
      currentRound: 1,
      players: [player("p1", "Ada", "t1"), player("p2", "Grace", "t2")],
      teams: [
        team("t1", "Owls", [player("p1", "Ada", "t1")]),
        team("t2", "Bears", [player("p2", "Grace", "t2")]),
      ],
      rounds: [
        {
          number: 1,
          category: "Capitals",
          status: "REVEALED",
          releasedCount: 3,
          questionCount: 3,
          doublingAllowed: true,
          questions: [question(1), question(2), question(3)],
        },
        {
          number: 2,
          category: "Music",
          status: "DRAFT",
          releasedCount: 0,
          questionCount: 1,
          doublingAllowed: true,
          questions: [question(1)],
        },
      ],
    });

  it("does not treat the round it just revealed as still in play", async () => {
    // currentRound still points at it, so matching on the number alone showed
    // the live panel for a finished round — and hid every control for getting
    // to the next one. The quiz looked over after one round.
    setGmToken("g1", "token");
    serve(revealed());
    renderDashboard();

    await waitFor(() => expect(screen.getByText(/round 1 · capitals/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /release next/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark the answers/i })).not.toBeInTheDocument();
  });

  it("offers the next written round, and a way to write another", async () => {
    setGmToken("g1", "token");
    serve(revealed());
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start round 2/i })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: /new round/i })).toBeInTheDocument();
  });

  it("starts the next round from a reveal", async () => {
    setGmToken("g1", "token");
    serve(revealed());
    renderDashboard();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /start round 2/i })).toBeEnabled(),
    );

    await userEvent.click(screen.getByRole("button", { name: /start round 2/i }));
    await waitFor(() => expect(calls.some((call) => call.query.includes("StartRound"))).toBe(true));
    expect(calls.find((call) => call.query.includes("StartRound"))?.variables).toEqual({
      gameId: "g1",
      gmToken: "token",
      roundNumber: 2,
    });
  });
});

describe("submission tracking", () => {
  it("ignores a slow read for a round that is no longer in play", async () => {
    // The answer is stale by the time it lands, not merely late: showing round
    // 1's hand-ins against round 2 would tell the host everyone was done.
    //
    // Racing this needs the round to change *while* a read is in flight, so the
    // subscription is driven by hand rather than left inert.
    setGmToken("g1", "token");
    const teams = [
      team("t1", "Owls", [player("p1", "Ada", "t1")]),
      team("t2", "Bears", [player("p2", "Grace", "t2")]),
    ];
    const players = [player("p1", "Ada", "t1"), player("p2", "Grace", "t2")];
    const round = (currentRound: number, category: string) =>
      game({
        status: "ROUND_ACTIVE",
        currentRound,
        players,
        teams,
        rounds: [
          {
            number: currentRound,
            category,
            status: "ACTIVE",
            releasedCount: 1,
            questionCount: 1,
            doublingAllowed: true,
            questions: [question(1)],
          },
        ],
      });

    let served = round(1, "One");
    let release: (() => void) | undefined;
    const roundOneStalls = new Promise<void>((resolve) => {
      release = resolve;
    });

    const sockets: DrivableSocket[] = [];
    class DrivableSocket extends InertSocket {
      constructor() {
        super();
        sockets.push(this);
      }
      override send(): void {}
    }
    vi.stubGlobal("WebSocket", DrivableSocket);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          query: string;
          variables: Record<string, unknown>;
        };
        if (body.query.includes("query RoundResults")) {
          if (body.variables.roundNumber === 1) {
            await roundOneStalls;
            return {
              ok: true,
              status: 200,
              json: async () => ({
                data: {
                  roundResults: {
                    round: null,
                    responses: teams.map((t) => ({
                      roundNumber: 1,
                      questionNumber: 1,
                      teamId: t.id,
                      answers: ["x"],
                      doubled: false,
                      graded: false,
                      gradedPoints: null,
                    })),
                    standings: [],
                  },
                },
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: { roundResults: { round: null, responses: [], standings: [] } },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: { game: served } }) };
      }),
    );

    renderDashboard();
    await waitFor(() => expect(screen.getByText(/round 1 · one/i)).toBeInTheDocument());

    // The host starts round 2 while round 1's read is still hanging.
    served = round(2, "Two");
    const socket = sockets[0];
    socket.readyState = 1;
    socket.onopen?.();
    socket.onmessage?.({
      data: JSON.stringify({ type: "connection_ack", payload: { connectionTimeoutMs: 300000 } }),
    } as MessageEvent<string>);
    socket.onmessage?.({ data: JSON.stringify({ type: "start_ack" }) } as MessageEvent<string>);
    socket.onmessage?.({
      data: JSON.stringify({
        type: "data",
        payload: { data: { onGameUpdated: { ...served, gameId: "g1", event: "ROUND_STARTED", game: served } } },
      }),
    } as MessageEvent<string>);

    await waitFor(() => expect(screen.getByText(/round 2 · two/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/0 of 2 teams in/i)).toBeInTheDocument());

    release?.();
    // Round 1's answer lands now, and must be thrown away rather than claiming
    // both teams have handed in for round 2.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText(/0 of 2 teams in/i)).toBeInTheDocument();
    expect(screen.queryByText(/2 of 2 teams in/i)).not.toBeInTheDocument();
  });
});

describe("when the game is gone", () => {
  it("says so instead of showing an empty dashboard", async () => {
    setGmToken("g1", "token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { game: null } }) }),
    );
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByText(/finished or been cleared away/i)).toBeInTheDocument(),
    );
  });
});
