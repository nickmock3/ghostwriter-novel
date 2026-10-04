import { describe, expect, it, vi } from "vitest";
import {
  createLlmSecretStore,
  createSystemCredentialAdapter,
  unsupportedSystemCredentialAdapter,
  type SystemCredentialAdapter,
} from "./llmSecretStore";

function memoryAdapter(initial: Record<string, string> = {}): SystemCredentialAdapter {
  const values = new Map(Object.entries(initial));

  return {
    deletePassword: vi.fn(async (_service, account) => {
      values.delete(account);
    }),
    getPassword: vi.fn(async (_service, account) => values.get(account) ?? null),
    setPassword: vi.fn(async (_service, account, password) => {
      values.set(account, password);
    }),
  };
}

describe("LLM secret store", () => {
  it("resolves env API keys before system credentials and hides key bodies in status", async () => {
    const adapter = memoryAdapter({ "ghostwriter/openai": "system-openai-secret" });
    const store = createLlmSecretStore({
      adapter,
      env: { OPENAI_API_KEY: "env-openai-secret" },
    });

    await expect(store.getApiKey("openai")).resolves.toBe("env-openai-secret");
    await expect(store.getStatus("openai")).resolves.toEqual({
      canDelete: false,
      canUpdate: false,
      isConfigured: true,
      maskedSuffix: "cret",
      providerId: "openai",
      source: "env",
    });
    expect(JSON.stringify(await store.getStatus("openai"))).not.toContain("env-openai-secret");
    expect(JSON.stringify(await store.getStatus("openai"))).not.toContain("system-openai-secret");
  });

  it("does not treat desktop sidecar control variables as LLM API keys", async () => {
    const store = createLlmSecretStore({
      adapter: memoryAdapter(),
      env: {
        GHOSTWRITER_ALLOWED_ORIGINS: "tauri://localhost",
        GHOSTWRITER_DATA_DIR: "/application-data",
        GHOSTWRITER_SIDECAR_TOKEN: "desktop-token",
      },
    });

    await expect(store.getStatus("openai")).resolves.toMatchObject({
      canUpdate: true,
      isConfigured: false,
      source: "missing",
    });
  });

  it("uses system credentials instead of env API keys in packaged desktop mode", async () => {
    const adapter = memoryAdapter({ "ghostwriter/openai": "system-openai-secret" });
    const store = createLlmSecretStore({
      adapter,
      env: {
        GHOSTWRITER_RUNTIME_MODE: "desktop-packaged",
        OPENAI_API_KEY: "env-openai-secret",
      },
    });

    await expect(store.getApiKey("openai")).resolves.toBe("system-openai-secret");
    await expect(store.getStatus("openai")).resolves.toMatchObject({
      canDelete: true,
      canUpdate: true,
      source: "system",
    });

    await store.setApiKey("openai", "updated-system-secret");
    await expect(store.getApiKey("openai")).resolves.toBe("updated-system-secret");
    await store.deleteApiKey("openai");
    await expect(store.getApiKey("openai")).resolves.toBeNull();
  });

  it("reports, updates, and deletes system credential API keys", async () => {
    const adapter = memoryAdapter();
    const store = createLlmSecretStore({ adapter, env: {} });

    await expect(store.getStatus("deepseek")).resolves.toEqual({
      canDelete: false,
      canUpdate: true,
      isConfigured: false,
      providerId: "deepseek",
      source: "missing",
    });

    await store.setApiKey("deepseek", "deepseek-system-secret");

    await expect(store.getApiKey("deepseek")).resolves.toBe("deepseek-system-secret");
    await expect(store.getStatus("deepseek")).resolves.toEqual({
      canDelete: true,
      canUpdate: true,
      isConfigured: true,
      maskedSuffix: "cret",
      providerId: "deepseek",
      source: "system",
    });

    await store.deleteApiKey("deepseek");
    await expect(store.getApiKey("deepseek")).resolves.toBeNull();
  });

  it("reads legacy system credentials only when Ghostwriter credentials are missing", async () => {
    const legacyOnlyStore = createLlmSecretStore({
      adapter: memoryAdapter({ "simple-ai-agent/gemini": "legacy-gemini-secret" }),
      env: {},
    });

    await expect(legacyOnlyStore.getApiKey("gemini")).resolves.toBe("legacy-gemini-secret");

    const newAndLegacyStore = createLlmSecretStore({
      adapter: memoryAdapter({
        "ghostwriter/gemini": "ghostwriter-gemini-secret",
        "simple-ai-agent/gemini": "legacy-gemini-secret",
      }),
      env: {},
    });

    await expect(newAndLegacyStore.getApiKey("gemini")).resolves.toBe(
      "ghostwriter-gemini-secret",
    );
  });

  it("keeps legacy system credential fallback but prefers ghostwriter credentials", async () => {
    const adapter = memoryAdapter({
      "ghostwriter/openai": "new-openai-secret",
      "simple-ai-agent/openai": "legacy-openai-secret",
      "simple-ai-agent/deepseek": "legacy-deepseek-secret",
    });
    const store = createLlmSecretStore({ adapter, env: {} });

    await expect(store.getApiKey("openai")).resolves.toBe("new-openai-secret");
    await expect(store.getApiKey("deepseek")).resolves.toBe("legacy-deepseek-secret");
    await expect(store.getStatus("deepseek")).resolves.toMatchObject({
      isConfigured: true,
      maskedSuffix: "cret",
      providerId: "deepseek",
      source: "system",
    });
  });

  it("rejects updates and deletes when an env key is configured", async () => {
    const store = createLlmSecretStore({
      adapter: memoryAdapter(),
      env: { GOOGLE_GENERATIVE_AI_API_KEY: "env-google-secret" },
    });

    await expect(store.setApiKey("gemini", "new-secret")).rejects.toThrow(/environment variable/i);
    await expect(store.deleteApiKey("gemini")).rejects.toThrow(/environment variable/i);
  });

  it("supports Anthropic env and system credential API keys", async () => {
    const adapter = memoryAdapter();
    const store = createLlmSecretStore({ adapter, env: {} });

    await store.setApiKey("anthropic", "anthropic-system-secret");

    await expect(store.getApiKey("anthropic")).resolves.toBe("anthropic-system-secret");
    await expect(store.getStatus("anthropic")).resolves.toEqual({
      canDelete: true,
      canUpdate: true,
      isConfigured: true,
      maskedSuffix: "cret",
      providerId: "anthropic",
      source: "system",
    });

    const envStore = createLlmSecretStore({
      adapter,
      env: { ANTHROPIC_API_KEY: "anthropic-env-secret" },
    });
    await expect(envStore.getApiKey("anthropic")).resolves.toBe("anthropic-env-secret");
    await expect(envStore.setApiKey("anthropic", "new-secret")).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it("returns a clear unsupported error for unsupported operating systems", async () => {
    const store = createLlmSecretStore({
      adapter: unsupportedSystemCredentialAdapter("linux"),
      env: {},
    });

    await expect(store.getStatus("openai")).resolves.toMatchObject({
      canDelete: false,
      canUpdate: false,
      isConfigured: false,
      providerId: "openai",
      source: "missing",
    });
    await expect(store.setApiKey("openai", "secret")).rejects.toThrow(/not supported.*linux/i);
    await expect(store.deleteApiKey("openai")).rejects.toThrow(/not supported.*linux/i);
  });

  it("creates macOS, Windows, and unsupported adapters by platform", () => {
    expect(createSystemCredentialAdapter("darwin").kind).toBe("macos-keychain");
    expect(createSystemCredentialAdapter("win32").kind).toBe("windows-credential-manager");
    expect(createSystemCredentialAdapter("linux").kind).toBe("unsupported");
  });

  it("builds exact macOS security commands without exposing API key bodies in status", async () => {
    const invocations: Array<{ args: string[]; command: string }> = [];
    let storedSecret: string | null = null;
    const adapter = createSystemCredentialAdapter("darwin", async (command, args) => {
      invocations.push({ args, command });
      if (command === "security" && args[0] === "find-generic-password") {
        return { stderr: "", stdout: storedSecret ?? "" };
      }
      if (command === "security" && args[0] === "add-generic-password") {
        storedSecret = args.at(-1) ?? null;
      }
      if (command === "security" && args[0] === "delete-generic-password") {
        storedSecret = null;
      }
      return { stderr: "", stdout: "" };
    });
    const store = createLlmSecretStore({ adapter, env: {} });

    await store.setApiKey("openai", "desktop-secret");
    await store.getApiKey("openai");
    const configuredStatus = await store.getStatus("openai");
    expect(configuredStatus).toMatchObject({
      isConfigured: true,
      maskedSuffix: "cret",
      source: "system",
    });
    expect(JSON.stringify(configuredStatus)).not.toContain("desktop-secret");
    await store.deleteApiKey("openai");
    expect(invocations.at(-1)).toEqual({
      args: ["delete-generic-password", "-s", "ghostwriter", "-a", "ghostwriter/openai"],
      command: "security",
    });

    const status = await store.getStatus("openai");
    expect(status).toMatchObject({
      isConfigured: false,
      source: "missing",
    });
    expect(JSON.stringify(status)).not.toContain("desktop-secret");
    expect(invocations[0]).toEqual({
      args: [
        "add-generic-password",
        "-U",
        "-s",
        "ghostwriter",
        "-a",
        "ghostwriter/openai",
        "-w",
        "desktop-secret",
      ],
      command: "security",
    });
    expect(invocations[1]).toEqual({
      args: [
        "find-generic-password",
        "-s",
        "ghostwriter",
        "-a",
        "ghostwriter/openai",
        "-w",
      ],
      command: "security",
    });
  });

  it("builds exact Windows PowerShell credential commands without logging API key bodies", async () => {
    const invocations: Array<{
      args: string[];
      command: string;
      stdin?: string;
    }> = [];
    let storedSecret: string | null = null;
    const adapter = createSystemCredentialAdapter("win32", async (command, args, options) => {
      invocations.push({ args, command, stdin: options?.stdin });
      const payload = options?.stdin ? JSON.parse(options.stdin) : null;
      if (payload?.operation === "set") {
        storedSecret = payload.password ?? null;
        return { stderr: "", stdout: "" };
      }
      if (payload?.operation === "get") {
        return { stderr: "", stdout: storedSecret ?? "" };
      }
      if (payload?.operation === "delete") {
        storedSecret = null;
      }
      return { stderr: "", stdout: "" };
    });
    const store = createLlmSecretStore({ adapter, env: {} });

    await store.setApiKey("deepseek", "windows-secret");
    await store.getApiKey("deepseek");
    const configuredStatus = await store.getStatus("deepseek");
    expect(JSON.stringify(configuredStatus)).not.toContain("windows-secret");
    await store.deleteApiKey("deepseek");
    expect(invocations[3]?.stdin).toBe(
      JSON.stringify({
        account: "ghostwriter/deepseek",
        operation: "delete",
        target: "ghostwriter:ghostwriter/deepseek",
      }),
    );

    const status = await store.getStatus("deepseek");
    expect(JSON.stringify(status)).not.toContain("windows-secret");
    expect(invocations.every((invocation) => invocation.command === "powershell.exe")).toBe(true);
    expect(invocations[0]?.args).toEqual([
      "-WindowStyle",
      "Hidden",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      expect.stringContaining("CredWrite"),
    ]);
    expect(invocations[1]?.args).toEqual([
      "-WindowStyle",
      "Hidden",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      expect.stringContaining("CredRead"),
    ]);
    expect(invocations[2]?.args).toEqual([
      "-WindowStyle",
      "Hidden",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      expect.stringContaining("CredDelete"),
    ]);
    expect(invocations[0]?.stdin).toBe(
      JSON.stringify({
        account: "ghostwriter/deepseek",
        operation: "set",
        password: "windows-secret",
        target: "ghostwriter:ghostwriter/deepseek",
      }),
    );
    expect(invocations[1]?.stdin).toBe(
      JSON.stringify({
        account: "ghostwriter/deepseek",
        operation: "get",
        target: "ghostwriter:ghostwriter/deepseek",
      }),
    );
  });
});
