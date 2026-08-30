import { describe, expect, it } from "vitest";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@know-it-owl/functions/lib/errors";

describe("errors", () => {
  it("carries a code, a name and a message", () => {
    const error = new NotFoundError("no game");
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.name).toBe("NotFoundError");
    expect(error.message).toBe("no game");
  });

  it("gives each error type a distinct code and a default message", () => {
    expect(new ForbiddenError().code).toBe("FORBIDDEN");
    expect(new ValidationError().code).toBe("VALIDATION");
    expect(new ConflictError().code).toBe("CONFLICT");
    expect(new ConflictError().message).toBe("Conflicting state");
  });
});
