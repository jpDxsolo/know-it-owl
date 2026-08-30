/** Readers for AppSync resolver arguments, which arrive as `unknown`. */
import { ValidationError } from "./errors.js";

export interface StringArgOptions {
  /** Reject anything longer than this after trimming. */
  maxLength?: number;
  /** Uppercase the value before returning it (join codes). */
  uppercase?: boolean;
}

/**
 * Read a required string argument. Surrounding whitespace is trimmed, and an
 * empty result is rejected — a display name of `"   "` is not a name.
 */
export function requiredString(
  args: Record<string, unknown>,
  name: string,
  options: StringArgOptions = {},
): string {
  const raw = args[name];
  if (typeof raw !== "string") {
    throw new ValidationError(`"${name}" is required and must be a string`);
  }
  const value = options.uppercase ? raw.trim().toUpperCase() : raw.trim();
  if (value.length === 0) {
    throw new ValidationError(`"${name}" must not be empty`);
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new ValidationError(`"${name}" must be at most ${options.maxLength} characters`);
  }
  return value;
}

/** Read an optional string argument, treating null/undefined alike. */
export function optionalString(
  args: Record<string, unknown>,
  name: string,
  options: StringArgOptions = {},
): string | undefined {
  const raw = args[name];
  if (raw === undefined || raw === null) return undefined;
  return requiredString(args, name, options);
}

export interface IntArgOptions {
  min?: number;
  max?: number;
}

/** Read a required integer argument. GraphQL `Int!` guarantees a number, not a sane one. */
export function requiredInt(
  args: Record<string, unknown>,
  name: string,
  options: IntArgOptions = {},
): number {
  const value = args[name];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ValidationError(`"${name}" is required and must be an integer`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new ValidationError(`"${name}" must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new ValidationError(`"${name}" must be at most ${options.max}`);
  }
  return value;
}

/** Read a required nested input object, e.g. the `input` of `submitAnswers`. */
export function requiredObject(
  args: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  const value = args[name];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError(`"${name}" is required and must be an object`);
  }
  return value as Record<string, unknown>;
}
