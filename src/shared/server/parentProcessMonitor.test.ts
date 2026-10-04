import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseParentProcessId,
  startParentProcessMonitor,
} from "./parentProcessMonitor";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseParentProcessId", () => {
  it("accepts only positive integer process ids", () => {
    expect(parseParentProcessId("1234")).toBe(1234);
    expect(parseParentProcessId(undefined)).toBeUndefined();
    expect(parseParentProcessId("0")).toBeUndefined();
    expect(parseParentProcessId("12.5")).toBeUndefined();
    expect(parseParentProcessId("not-a-pid")).toBeUndefined();
  });
});

describe("startParentProcessMonitor", () => {
  it("runs the exit callback once when the parent disappears", async () => {
    vi.useFakeTimers();
    const onParentExit = vi.fn();
    const stop = startParentProcessMonitor({
      intervalMs: 100,
      isProcessAlive: vi.fn().mockReturnValueOnce(true).mockReturnValue(false),
      onParentExit,
      parentPid: 1234,
    });

    await vi.advanceTimersByTimeAsync(250);

    expect(onParentExit).toHaveBeenCalledOnce();
    stop();
  });
});
