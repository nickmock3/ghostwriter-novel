import { describe, expect, it } from "vitest";
import { formatApplicationVersion } from "./appVersion";

describe("formatApplicationVersion", () => {
  it.each([
    ["0.20preview3", "v0.20 preview 3"],
    ["0.20.0-preview.3", "v0.20.0 preview 3"],
    ["1.2.3", "v1.2.3"],
  ])("formats %s for UI display", (rawVersion, expectedDisplayVersion) => {
    expect(formatApplicationVersion(rawVersion)).toBe(expectedDisplayVersion);
  });

  it("falls back to the raw version with a v prefix for unexpected formats", () => {
    expect(formatApplicationVersion("internal-build")).toBe("vinternal-build");
    expect(formatApplicationVersion("internal-preview.3")).toBe("vinternal-preview.3");
  });
});
