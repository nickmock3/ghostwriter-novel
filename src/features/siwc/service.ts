import { protectPrivateDirectory } from "../../shared/server/privateDirectories";
import { join, resolve } from "node:path";
import { activeAccount } from "./access";
import { listAccounts, selectAccount } from "./accounts";
import type { Account } from "./credentials";
import { login, type LoginDependencies } from "./login";
import { logout } from "./logout";
import { listModels } from "./models";
import type { Fetch } from "./oidc";
import { refreshSelected } from "./refresh";
import { BoundaryError, failure, safely, success, type Result } from "./result";
import { createCredentialStore } from "./store";

export type SiwcRun = Readonly<{
  accountId: string;
  // サーバー専用。SDK呼出しの各stepで資格情報を取得し直す。
  fetch: Fetch;
}>;
export type SiwcServiceOptions = Readonly<{
  dataRoot: string;
  fetch?: Fetch;
  now?: () => number;
}>;
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new BoundaryError(result.error);
  return result.value;
};

export function createSiwcService(options: SiwcServiceOptions) {
  protectPrivateDirectory(join(options.dataRoot, "siwc"));
  const store = createCredentialStore(join(options.dataRoot, "siwc"));
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let runs = 0;
  let mutating = false;
  // 短い資格情報transactionだけ直列化し、推論・tool自体は並行実行できる。
  let tail = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  const mutate = async <T>(operation: () => Promise<Result<T>>): Promise<Result<T>> => {
    if (mutating || runs > 0) return failure("busy");
    mutating = true;
    try { return await operation(); }
    finally { mutating = false; }
  };
  const accountForRequest = (signal: AbortSignal, accountId?: string): Promise<Account> =>
    serial(async () => unwrap(await store.update(async (state, checkpoint) => {
      if (accountId !== undefined && state.activeAccountId !== accountId) throw new BoundaryError("account_changed");
      const updated = await refreshSelected(state, checkpoint, { fetch: fetcher, signal, now });
      return { state: updated, value: activeAccount(updated, now()) };
    })));

  const withRun = async <T>(
    operation: (run: SiwcRun) => Promise<T>,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<Result<T>> => {
    if (mutating) return failure("busy");
    runs++;
    let active = true;
    try {
      return await safely(async () => {
        const initial = await accountForRequest(signal);
        const authorizedFetch: Fetch = async (url, init) => {
          if (!active || signal.aborted || init.signal?.aborted) throw new BoundaryError("cancelled");
          if (url !== "https://api.openai.com/v1/responses" && url !== "https://api.openai.com/v1/models") throw new BoundaryError("unsupported_request");
          const combined = AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]);
          const account = await accountForRequest(combined, initial.id);
          if (!active || combined.aborted) throw new BoundaryError("cancelled");
          const headers = new Headers(init.headers);
          headers.set("authorization", `Bearer ${account.session!.accessToken}`);
          try {
            return await fetcher(url, { ...init, headers, redirect: "error", signal: combined });
          } catch {
            throw new BoundaryError(combined.aborted ? "cancelled" : "network");
          }
        };
        return operation({ accountId: initial.id, fetch: authorizedFetch });
      }, "network");
    } finally {
      active = false;
      runs--;
    }
  };

  return {
    withRun,
    async status() {
      const read = await store.read();
      if (!read.ok) return read;
      return success({ accounts: listAccounts(read.value, now()), busy: mutating || runs > 0 });
    },
    login(options: Omit<LoginDependencies, "store" | "fetch" | "now">, accountId?: string) {
      return mutate(() => login({ ...options, store, fetch: fetcher, now }, accountId));
    },
    selectAccount(id: string) { return mutate(() => selectAccount(store, id)); },
    logout(signal: AbortSignal) { return mutate(() => logout(store, fetcher, signal)); },
    models(signal?: AbortSignal) {
      return withRun(async run => {
        // 最新sessionはrun.fetchで取得。一覧の検証も同じ境界を再利用する。
        const read = unwrap(await store.read());
        if (!read || read.activeAccountId !== run.accountId) throw new BoundaryError("account_changed");
        const account = activeAccount(read, now());
        const models = unwrap(await listModels(account, run.fetch, signal ?? new AbortController().signal, now()));
        return { accountId: run.accountId, models };
      }, signal);
    },
  };
}
export type SiwcService = ReturnType<typeof createSiwcService>;

// 同じsidecar内の各API・各役割でrunとmutationの調停を共有する。
const services = new Map<string, SiwcService>();
export function getSiwcService(dataRoot: string): SiwcService {
  const key = resolve(dataRoot);
  let service = services.get(key);
  if (!service) {
    service = createSiwcService({ dataRoot: key });
    services.set(key, service);
  }
  return service;
}
