import { describe, expect, it } from "vitest";
import { isApplicationStorageError } from "./applicationStorage";

describe("isApplicationStorageError", () => {
  it.each([
    "EACCES",
    "EDQUOT",
    "EISDIR",
    "EMFILE",
    "ENFILE",
    "ENOSPC",
    "ENOTDIR",
    "EPERM",
    "EROFS",
  ])("recognizes %s as unavailable application storage", (code) => {
    expect(isApplicationStorageError(Object.assign(new Error("storage failed"), { code }))).toBe(
      true,
    );
  });

  it("does not classify domain errors as storage failures", () => {
    expect(isApplicationStorageError(new Error("Invalid conversation history file"))).toBe(false);
  });
});
