import { describe, expect, it } from "vitest";
import type { Game } from "@know-it-owl/frontend/hooks/useGame";
import {
  parseQuizFile,
  quizFileName,
  QuizFileError,
  QUIZ_FILE_VERSION,
  toQuestionInputs,
  toQuizFile,
} from "@know-it-owl/frontend/services/quizFile";

function textQuestion(number: number) {
  return {
    number,
    type: "TEXT" as const,
    text: `Question ${number}?`,
    imageUrl: null,
    imageKey: null,
    defaultPoints: 2,
    correctAnswers: [`Answer ${number}`],
  };
}

function pictureQuestion(number: number) {
  return {
    number,
    type: "PICTURE_10" as const,
    text: null,
    // A presigned URL, which is exactly what a saved quiz must not rely on.
    imageUrl: "https://s3.test/games/old-game/pic?X-Amz-Expires=3600",
    imageKey: "games/old-game/pic",
    defaultPoints: 1,
    correctAnswers: Array.from({ length: 10 }, (_, index) => `Thing ${index + 1}`),
  };
}

const rounds: Game["rounds"] = [
  {
    number: 1,
    category: "Capitals",
    status: "REVEALED",
    releasedCount: 1,
    questionCount: 1,
    doublingAllowed: true,
    questions: [textQuestion(1)],
  },
  {
    number: 2,
    category: "Spot the landmark",
    status: "DRAFT",
    releasedCount: 0,
    questionCount: 1,
    doublingAllowed: false,
    questions: [pictureQuestion(1)],
  },
];

describe("writing a quiz out", () => {
  it("keeps the categories, questions, answers and the doubling rule", () => {
    const file = toQuizFile("Tuesday", rounds);

    expect(file.knowItOwlQuiz).toBe(QUIZ_FILE_VERSION);
    expect(file.name).toBe("Tuesday");
    expect(file.rounds.map((round) => round.category)).toEqual([
      "Capitals",
      "Spot the landmark",
    ]);
    expect(file.rounds[1].doublingAllowed).toBe(false);
    expect(file.rounds[0].questions[0]).toMatchObject({
      type: "TEXT",
      text: "Question 1?",
      correctAnswers: ["Answer 1"],
      defaultPoints: 2,
    });
  });

  it("saves the storage key, not the presigned URL", () => {
    // The URL dies within the hour; a quiz file is meant to outlive the game
    // it came from, so the key is the only durable reference.
    const file = toQuizFile("Tuesday", rounds);
    expect(file.rounds[1].questions[0].imageKey).toBe("games/old-game/pic");
    expect(JSON.stringify(file)).not.toContain("X-Amz-Expires");
  });

  it("survives a round trip unchanged", () => {
    const file = toQuizFile("Tuesday", rounds);
    expect(parseQuizFile(JSON.stringify(file))).toEqual(file);
  });

  it("does not carry the round's play state across", () => {
    // status and releasedCount belong to the game it was played in, not to
    // the quiz — opening it elsewhere must start a fresh draft.
    const serialised = JSON.stringify(toQuizFile("Tuesday", rounds));
    expect(serialised).not.toContain("REVEALED");
    expect(serialised).not.toContain("releasedCount");
  });
});

describe("reading a quiz back", () => {
  const valid = () => JSON.stringify(toQuizFile("Tuesday", rounds));

  it("turns a round into what createRound takes", () => {
    const quiz = parseQuizFile(valid());
    expect(toQuestionInputs(quiz.rounds[0])).toEqual([
      {
        type: "TEXT",
        text: "Question 1?",
        correctAnswers: ["Answer 1"],
        defaultPoints: 2,
      },
    ]);
    expect(toQuestionInputs(quiz.rounds[1])[0]).toMatchObject({
      type: "PICTURE_10",
      imageKey: "games/old-game/pic",
    });
  });

  it("treats a missing doubling flag as allowed, exactly as the server does", () => {
    const quiz = parseQuizFile(
      JSON.stringify({
        knowItOwlQuiz: 1,
        name: "Old",
        rounds: [
          {
            category: "Capitals",
            questions: [
              { type: "TEXT", text: "Q?", correctAnswers: ["A"], defaultPoints: 1 },
            ],
          },
        ],
      }),
    );
    expect(quiz.rounds[0].doublingAllowed).toBe(true);
  });

  it("names the quiz something rather than nothing", () => {
    const quiz = parseQuizFile(
      JSON.stringify({ ...JSON.parse(valid()), name: "   " }),
    );
    expect(quiz.name).toBe("Quiz");
  });
});

describe("refusing a file that is not a quiz", () => {
  /** Each case is a file a host could plausibly pick by mistake, or edit. */
  const rejected: [string, unknown | string, RegExp][] = [
    ["something that is not JSON at all", "not json {", /isn't even JSON/i],
    ["a JSON array", [], /right shape/i],
    ["JSON from another app", { hello: "world" }, /wasn't written by Know It Owl/i],
    [
      "a quiz from a newer version",
      { knowItOwlQuiz: 99, name: "x", rounds: [] },
      /newer version/i,
    ],
    ["a quiz with no rounds", { knowItOwlQuiz: 1, name: "x", rounds: [] }, /no rounds/i],
    [
      "a round with no category",
      { knowItOwlQuiz: 1, name: "x", rounds: [{ questions: [] }] },
      /no category/i,
    ],
    [
      "a round with no questions",
      { knowItOwlQuiz: 1, name: "x", rounds: [{ category: "C", questions: [] }] },
      /no questions/i,
    ],
    [
      "a text question with no text",
      {
        knowItOwlQuiz: 1,
        name: "x",
        rounds: [
          { category: "C", questions: [{ type: "TEXT", correctAnswers: ["a"], defaultPoints: 1 }] },
        ],
      },
      /no question text/i,
    ],
    [
      "a picture question with no picture",
      {
        knowItOwlQuiz: 1,
        name: "x",
        rounds: [
          {
            category: "C",
            questions: [
              {
                type: "PICTURE_10",
                correctAnswers: Array.from({ length: 10 }, () => "a"),
                defaultPoints: 1,
              },
            ],
          },
        ],
      },
      /no picture/i,
    ],
    [
      "a picture question with the wrong number of answers",
      {
        knowItOwlQuiz: 1,
        name: "x",
        rounds: [
          {
            category: "C",
            questions: [
              {
                type: "PICTURE_10",
                imageKey: "k",
                correctAnswers: ["a"],
                defaultPoints: 1,
              },
            ],
          },
        ],
      },
      /exactly 10 answers/i,
    ],
    [
      "a question of an unknown type",
      {
        knowItOwlQuiz: 1,
        name: "x",
        rounds: [
          { category: "C", questions: [{ type: "AUDIO", correctAnswers: ["a"], defaultPoints: 1 }] },
        ],
      },
      /unknown type/i,
    ],
    [
      "points that are not a whole number",
      {
        knowItOwlQuiz: 1,
        name: "x",
        rounds: [
          {
            category: "C",
            questions: [{ type: "TEXT", text: "Q", correctAnswers: ["a"], defaultPoints: 1.5 }],
          },
        ],
      },
      /invalid points/i,
    ],
  ];

  it.each(rejected)("refuses %s", (_name, contents, message) => {
    const raw = typeof contents === "string" ? contents : JSON.stringify(contents);
    expect(() => parseQuizFile(raw)).toThrow(QuizFileError);
    expect(() => parseQuizFile(raw)).toThrow(message);
  });

  it("says which round and question is wrong, so it can be found", () => {
    const file = {
      knowItOwlQuiz: 1,
      name: "x",
      rounds: [
        {
          category: "Fine",
          questions: [{ type: "TEXT", text: "Q", correctAnswers: ["a"], defaultPoints: 1 }],
        },
        {
          category: "Broken",
          questions: [
            { type: "TEXT", text: "Q", correctAnswers: ["a"], defaultPoints: 1 },
            { type: "TEXT", text: "", correctAnswers: ["a"], defaultPoints: 1 },
          ],
        },
      ],
    };
    expect(() => parseQuizFile(JSON.stringify(file))).toThrow(/Round 2, question 2/);
  });
});

describe("the filename", () => {
  it("is readable and sorts with its siblings", () => {
    expect(quizFileName("Know It Owl 2026-09-01")).toBe("know-it-owl-2026-09-01.kio.json");
  });

  it("falls back rather than producing a nameless file", () => {
    expect(quizFileName("!!!")).toBe("quiz.kio.json");
  });
});
