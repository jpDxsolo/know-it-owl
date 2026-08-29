/** Base class for errors that map to a client-visible GraphQL error. */
export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The requested entity does not exist. */
export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message);
  }
}

/** The caller is not authorized (bad or missing GM token). */
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message);
  }
}

/** The request is well-formed but the arguments are invalid. */
export class ValidationError extends AppError {
  constructor(message = "Invalid request") {
    super("VALIDATION", message);
  }
}

/** The game is not in a state that allows this operation. */
export class ConflictError extends AppError {
  constructor(message = "Conflicting state") {
    super("CONFLICT", message);
  }
}
