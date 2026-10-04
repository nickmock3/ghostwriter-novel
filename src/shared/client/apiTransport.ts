export type DesktopApiTransportConfig = {
  onUnavailable?: () => void;
  token: string;
  url: string;
};

let desktopConfig: DesktopApiTransportConfig | null = null;

function assertLoopbackBaseUrl(url: string): void {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();

  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]") {
    throw new Error(`Desktop API base URL must be loopback-only: ${url}`);
  }
}

export function configureDesktopApiTransport(config: DesktopApiTransportConfig): void {
  assertLoopbackBaseUrl(config.url);
  desktopConfig = config;
}

export function resetApiTransportForTests(): void {
  desktopConfig = null;
}

function resolveDesktopRequestUrl(input: string, baseUrl: string): string {
  if (!input.startsWith("/")) {
    throw new Error(`Desktop API requests must use a relative API path: ${input}`);
  }

  const normalizedBase = baseUrl.replace(/\/$/, "");
  return `${normalizedBase}${input}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!desktopConfig) {
    return fetch(input, init);
  }

  const url = resolveDesktopRequestUrl(input, desktopConfig.url);
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${desktopConfig.token}`);

  try {
    return await fetch(url, { ...init, headers });
  } catch (error) {
    if (!isAbortError(error)) {
      desktopConfig.onUnavailable?.();
    }
    throw error;
  }
}
