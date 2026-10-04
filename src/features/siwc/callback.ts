// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { createServer } from "node:http";
import type { Account } from "./credentials";
import { type Attempt, type Callback, validateCallback } from "./oauth";
import { BoundaryError, failure, type Result } from "./result";

export type CallbackListener = Readonly<{
  redirectUri: string;
  result: Promise<Result<Callback>>;
  close: () => void;
}>;
export type Listen = (
  attempt: Attempt,
  account: Pick<Account, "clientId"> | undefined,
  signal: AbortSignal,
) => Promise<CallbackListener>;

export const listenForCallback = async (
  attempt: Attempt,
  account: Pick<Account, "clientId"> | undefined,
  signal: AbortSignal,
  timeoutMs = 180000,
): Promise<CallbackListener> => {
  if (signal.aborted) throw new BoundaryError("cancelled");
  let complete: (value: Result<Callback>) => void = () => {};
  const result = new Promise<Result<Callback>>((resolve) => {
    complete = resolve;
  });
  let settled = false;
  let redirectUri = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (value: Result<Callback>) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    server.close();
    server.closeIdleConnections();
    complete(value);
  };
  const abort = () => {
    finish(failure("cancelled"));
    server.closeAllConnections();
  };
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Connection", "close");
    let url: URL;
    try {
      url = new URL(req.url ?? "", redirectUri);
    } catch {
      res.writeHead(400).end("Invalid callback.");
      return;
    }
    if (
      req.method !== "GET" ||
      url.origin !== new URL(redirectUri).origin ||
      req.headers.host !== new URL(redirectUri).host ||
      url.pathname !== "/auth/callback"
    ) {
      res.writeHead(404).end("Not found.");
      return;
    }
    if (settled) {
      res.writeHead(409).end("Attempt already finished.");
      return;
    }
    const value = validateCallback(url, attempt, account);
    res
      .writeHead(value.ok ? 200 : 400)
      .end(
        value.ok
          ? "Callback received. Return to Ghostwriter to check the result."
          : "Sign-in was not completed. Return to Ghostwriter.",
      );
    finish(value);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch {
    server.close();
    throw new BoundaryError("network");
  }
  server.on("error", () => finish(failure("network")));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new BoundaryError("network");
  }
  redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
  timer = setTimeout(() => {
    finish(failure("timeout"));
    server.closeAllConnections();
  }, timeoutMs);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return { redirectUri, result, close: abort };
};
