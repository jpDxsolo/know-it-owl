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
