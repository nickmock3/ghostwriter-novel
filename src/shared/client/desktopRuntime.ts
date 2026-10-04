import { configureDesktopApiTransport } from "./apiTransport";

export type SidecarConnection = {
  token: string;
  url: string;
};

export type DesktopRuntimeSnapshot =
  | { status: "error"; message: string }
  | { status: "ready" }
  | { status: "starting" };

export type DesktopRuntimeController = {
  getSnapshot: () => DesktopRuntimeSnapshot;
  markUnavailable: () => void;
  restart: () => Promise<void>;
  start: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
};

export const SIDECAR_DISCONNECT_MESSAGE = "ローカルAPIサーバーとの接続が切断されました。";
export const SIDECAR_STARTING_MESSAGE = "ローカルAPIサーバーを起動しています。";

const SIDECAR_CONNECT_RETRY_INTERVAL_MS = 250;

type DesktopRuntimeDependencies = {
  connect: () => Promise<SidecarConnection>;
  isDesktop: boolean;
  restart: () => Promise<SidecarConnection>;
};

export function isTauriDesktop(): boolean {
  return (
    typeof window !== "undefined" &&
    Object.prototype.hasOwnProperty.call(window, "__TAURI_INTERNALS__")
  );
}

async function invokeSidecarCommand(command: "get_sidecar_connection" | "restart_sidecar") {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SidecarConnection>(command);
}

export function createDefaultDesktopRuntimeDependencies(): DesktopRuntimeDependencies {
  const isDesktop = isTauriDesktop();

  return {
    connect: () => invokeSidecarCommand("get_sidecar_connection"),
    isDesktop,
    restart: () => invokeSidecarCommand("restart_sidecar"),
  };
}

export function createDesktopRuntimeController(
  dependencies: DesktopRuntimeDependencies,
): DesktopRuntimeController {
  const listeners = new Set<() => void>();
  let snapshot: DesktopRuntimeSnapshot = dependencies.isDesktop
    ? { status: "starting" }
    : { status: "ready" };
  let started = false;

  function emitChange(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSnapshot(nextSnapshot: DesktopRuntimeSnapshot): void {
    snapshot = nextSnapshot;
    emitChange();
  }

  function applyConnection(connection: SidecarConnection): void {
    configureDesktopApiTransport({
      onUnavailable: () => {
        markUnavailable();
      },
      token: connection.token,
      url: connection.url,
    });
  }

  function markUnavailable(): void {
    setSnapshot({
      message: SIDECAR_DISCONNECT_MESSAGE,
      status: "error",
    });
  }

  function errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    return "Sidecar connection failed";
  }

  function isRetryableStartingError(error: unknown): boolean {
    return errorMessage(error) === SIDECAR_STARTING_MESSAGE;
  }

  async function waitForRetryInterval(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, SIDECAR_CONNECT_RETRY_INTERVAL_MS);
    });
  }

  async function connectWithRetry(
    connect: () => Promise<SidecarConnection>,
  ): Promise<SidecarConnection> {
    while (true) {
      try {
        return await connect();
      } catch (error) {
        if (!isRetryableStartingError(error)) {
          throw error;
        }

        await waitForRetryInterval();
      }
    }
  }

  async function establishConnection(
    action: () => Promise<SidecarConnection>,
    options: { retryWhileStarting?: boolean } = {},
  ): Promise<void> {
    setSnapshot({ status: "starting" });

    try {
      const connection = options.retryWhileStarting
        ? await connectWithRetry(action)
        : await action();
      applyConnection(connection);
      setSnapshot({ status: "ready" });
    } catch (error) {
      setSnapshot({
        message: errorMessage(error),
        status: "error",
      });
    }
  }

  return {
    getSnapshot: () => snapshot,
    markUnavailable,
    restart: async () => {
      await establishConnection(dependencies.restart);
    },
    start: async () => {
      if (started) {
        return;
      }

      started = true;

      if (!dependencies.isDesktop) {
        setSnapshot({ status: "ready" });
        return;
      }

      await establishConnection(dependencies.connect, { retryWhileStarting: true });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const desktopRuntimeController = createDesktopRuntimeController(
  createDefaultDesktopRuntimeDependencies(),
);
