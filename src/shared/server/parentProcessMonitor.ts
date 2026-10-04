export type ParentProcessMonitorOptions = {
  intervalMs?: number;
  isProcessAlive?: (pid: number) => boolean;
  onParentExit: () => void | Promise<void>;
  parentPid: number;
};

export function parseParentProcessId(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) {
    return undefined;
  }

  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function startParentProcessMonitor(
  options: ParentProcessMonitorOptions,
): () => void {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) {
      return;
    }

    const isAlive = (options.isProcessAlive ?? processIsAlive)(options.parentPid);
    if (isAlive) {
      return;
    }

    stopped = true;
    clearInterval(timer);
    void options.onParentExit();
  }, options.intervalMs ?? 1_000);

  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
