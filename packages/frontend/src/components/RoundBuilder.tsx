/**
 * Writing a round.
 *
 * The only screen in the app that is desktop-shaped first: a picture question is
 * one image beside a ten-slot answer key, which needs width. It folds to a
 * single column on a phone rather than the other way round.
 *
 * Validation mirrors `packages/functions/src/lib/questionInput.ts` exactly. The
 * server is still the authority — this only exists so a host finds out about a
 * blank answer while looking at it, rather than after pressing Save.
 */
import { useState, type ChangeEvent } from "react";
import { ApiError, CreateRoundMutation, execute } from "../services/api";
import { uploadImage } from "../services/images";
import type { QuestionInput, QuestionType } from "../gql/graphql";
import "./RoundBuilder.css";

/** A PICTURE_10 is ten numbered things in one image, so it needs ten answers. */
const PICTURE_ANSWER_COUNT = 10;
const MAX_CATEGORY_LENGTH = 60;

/** A question while it is still being written, before it is valid enough to send. */
interface Draft {
  id: string;
  type: QuestionType;
  text: string;
  imageKey: string | null;
  /** Local preview URL, so the host sees what they uploaded. */
  imagePreview: string | null;
  uploading: boolean;
  /** One entry for TEXT, ten for PICTURE_10. */
  answers: string[];
  defaultPoints: number;
}

function emptyDraft(type: QuestionType = "TEXT"): Draft {
  return {
    id: crypto.randomUUID(),
    type,
    text: "",
    imageKey: null,
    imagePreview: null,
    uploading: false,
    answers: type === "TEXT" ? [""] : Array.from({ length: PICTURE_ANSWER_COUNT }, () => ""),
    defaultPoints: 1,
  };
}

/** Why this question cannot be saved yet, or undefined when it can. */
export function questionProblem(draft: Draft): string | undefined {
  if (draft.type === "TEXT") {
    if (draft.text.trim().length === 0) return "Add the question";
    if (draft.answers.every((answer) => answer.trim().length === 0)) return "Add an answer";
    return undefined;
  }
  if (!draft.imageKey) return "Add the picture";
  if (draft.answers.some((answer) => answer.trim().length === 0)) {
    const missing = draft.answers.filter((answer) => answer.trim().length === 0).length;
    return `Fill in all ten answers — ${missing} still empty`;
  }
  return undefined;
}

/** Turn a draft into what the API expects, dropping anything blank. */
function toInput(draft: Draft): QuestionInput {
  const answers = draft.answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0);
  return draft.type === "TEXT"
    ? {
        type: "TEXT",
        text: draft.text.trim(),
        correctAnswers: answers,
        defaultPoints: draft.defaultPoints,
      }
    : {
        type: "PICTURE_10",
        imageKey: draft.imageKey ?? "",
        correctAnswers: answers,
        defaultPoints: draft.defaultPoints,
      };
}

export interface RoundBuilderProps {
  gameId: string;
  gmToken: string;
  /** Shown in the heading; the server assigns the real number. */
  roundNumber: number;
  onSaved: () => void;
  onCancel: () => void;
}

export function RoundBuilder({ gameId, gmToken, roundNumber, onSaved, onCancel }: RoundBuilderProps) {
  const [category, setCategory] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft()]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string>();
  /** Only mark fields red once the host has tried to save. */
  const [attempted, setAttempted] = useState(false);

  const update = (id: string, change: Partial<Draft>): void =>
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...change } : draft)),
    );

  const setType = (draft: Draft, type: QuestionType): void => {
    if (type === draft.type) return;
    // The answer key means something different per type, so it is rebuilt
    // rather than carried across and left half-filled.
    update(draft.id, {
      type,
      answers:
        type === "TEXT" ? [""] : Array.from({ length: PICTURE_ANSWER_COUNT }, () => ""),
    });
  };

  const setAnswer = (draft: Draft, index: number, value: string): void =>
    update(draft.id, {
      answers: draft.answers.map((answer, at) => (at === index ? value : answer)),
    });

  async function pickImage(draft: Draft, event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Let the same file be chosen again after a failure.
    event.target.value = "";
    if (!file) return;

    update(draft.id, { uploading: true });
    setProblem(undefined);
    try {
      const imageKey = await uploadImage(gameId, gmToken, file);
      update(draft.id, {
        imageKey,
        imagePreview: URL.createObjectURL(file),
        uploading: false,
      });
    } catch (cause) {
      update(draft.id, { uploading: false });
      setProblem(cause instanceof ApiError ? cause.message : String(cause));
    }
  }

  const problems = drafts.map(questionProblem);
  const unfinished = problems.filter(Boolean).length;
  const categoryProblem = category.trim().length === 0 ? "Give the round a category" : undefined;
  const canSave = unfinished === 0 && !categoryProblem && !saving;

  async function save(): Promise<void> {
    setAttempted(true);
    if (!canSave) return;
    setSaving(true);
    setProblem(undefined);
    try {
      await execute(CreateRoundMutation, {
        gameId,
        gmToken,
        category: category.trim(),
        questions: drafts.map(toInput),
      });
      onSaved();
    } catch (cause) {
      setProblem(cause instanceof ApiError ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="kio-builder">
      <div className="kio-builder__head">
        <h1 className="kio-builder__title">Round {roundNumber}</h1>
        <p className="kio-muted">Draft — players can&rsquo;t see this yet</p>
        <button className="kio-button kio-button--ghost" type="button" onClick={onCancel}>
          Discard
        </button>
      </div>

      <div>
        <label className="kio-label" htmlFor="category">
          Category
        </label>
        <input
          id="category"
          className={`kio-input${attempted && categoryProblem ? " kio-input--invalid" : ""}`}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          maxLength={MAX_CATEGORY_LENGTH}
          placeholder="e.g. 90s Music"
          aria-invalid={attempted && categoryProblem !== undefined}
        />
        {attempted && categoryProblem && <p className="kio-field-error">{categoryProblem}</p>}
      </div>

      <ol className="kio-builder__questions">
        {drafts.map((draft, index) => {
          const invalid = attempted && problems[index] !== undefined;
          return (
            <li
              key={draft.id}
              className={`kio-card kio-question${invalid ? " kio-question--invalid" : ""}`}
            >
              <div className="kio-question__head">
                <span className="kio-question__number">{index + 1}</span>
                <div className="kio-segmented" role="group" aria-label={`Question ${index + 1} type`}>
                  {(["TEXT", "PICTURE_10"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={`kio-segmented__option${
                        draft.type === type ? " kio-segmented__option--on" : ""
                      }`}
                      aria-pressed={draft.type === type}
                      onClick={() => setType(draft, type)}
                    >
                      {type === "TEXT" ? "Text" : "Picture (10)"}
                    </button>
                  ))}
                </div>
                {drafts.length > 1 && (
                  <button
                    className="kio-button kio-button--ghost"
                    type="button"
                    onClick={() => setDrafts((current) => current.filter((d) => d.id !== draft.id))}
                  >
                    Remove
                  </button>
                )}
              </div>

              {draft.type === "TEXT" ? (
                <div className="kio-question__text">
                  <label className="kio-label" htmlFor={`q-${draft.id}`}>
                    Question
                  </label>
                  <textarea
                    id={`q-${draft.id}`}
                    className="kio-input kio-question__prompt"
                    value={draft.text}
                    onChange={(event) => update(draft.id, { text: event.target.value })}
                    rows={2}
                    placeholder="Which band released Nevermind?"
                  />
                  <label className="kio-label" htmlFor={`a-${draft.id}`}>
                    Answer
                  </label>
                  <input
                    id={`a-${draft.id}`}
                    className="kio-input"
                    value={draft.answers[0] ?? ""}
                    onChange={(event) => setAnswer(draft, 0, event.target.value)}
                    placeholder="Nirvana"
                  />
                </div>
              ) : (
                <div className="kio-question__picture">
                  <div className="kio-picture">
                    {draft.imagePreview ? (
                      <img className="kio-picture__preview" src={draft.imagePreview} alt="" />
                    ) : (
                      <div className="kio-picture__empty">No picture yet</div>
                    )}
                    <label className="kio-button kio-button--secondary kio-picture__pick">
                      {draft.uploading
                        ? "Uploading…"
                        : draft.imageKey
                          ? "Replace"
                          : "Choose picture"}
                      <input
                        className="kio-sr-only"
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={(event) => void pickImage(draft, event)}
                        disabled={draft.uploading}
                      />
                    </label>
                    <p className="kio-muted">One image, ten numbered things in it.</p>
                  </div>

                  <ol className="kio-answers">
                    {draft.answers.map((answer, at) => (
                      <li key={at} className="kio-answers__row">
                        <label className="kio-answers__number" htmlFor={`p-${draft.id}-${at}`}>
                          {at + 1}
                        </label>
                        <input
                          id={`p-${draft.id}-${at}`}
                          className="kio-input"
                          value={answer}
                          onChange={(event) => setAnswer(draft, at, event.target.value)}
                          aria-label={`Answer ${at + 1}`}
                        />
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="kio-question__foot">
                <label className="kio-label" htmlFor={`pts-${draft.id}`}>
                  Points each
                </label>
                <input
                  id={`pts-${draft.id}`}
                  className="kio-input kio-question__points"
                  type="number"
                  min={1}
                  value={draft.defaultPoints}
                  onChange={(event) =>
                    update(draft.id, { defaultPoints: Math.max(1, Number(event.target.value) || 1) })
                  }
                />
                {invalid && <p className="kio-field-error">{problems[index]}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      <button
        className="kio-builder__add"
        type="button"
        onClick={() => setDrafts((current) => [...current, emptyDraft()])}
      >
        + Add question
      </button>

      {problem && <p className="kio-field-error">{problem}</p>}

      <div className="kio-builder__foot">
        <p className="kio-muted">
          {drafts.length} {drafts.length === 1 ? "question" : "questions"}
          {attempted && unfinished > 0 && ` · ${unfinished} needs attention`}
        </p>
        <div className="kio-builder__actions">
          <button className="kio-button kio-button--secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="kio-button kio-button--primary" type="button" onClick={save}>
            {saving ? "Saving…" : "Save round"}
          </button>
        </div>
      </div>
    </section>
  );
}
