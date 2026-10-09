import { execFile } from "node:child_process";

import { isPackagedDesktopRuntime } from "../runtimeEnv";

export type LlmSecretProviderId =
  | "anthropic"
  | "deepseek"
  | "gemini"
  | "openai"
  | "openai-compatible";

export type LlmSecretStatus = {
  canDelete: boolean;
  canUpdate: boolean;
  isConfigured: boolean;
  maskedSuffix?: string;
  providerId: LlmSecretProviderId;
  source: "env" | "missing" | "system";
};

export type LlmSecretStore = {
  deleteApiKey(providerId: LlmSecretProviderId): Promise<void>;
  getApiKey(providerId: LlmSecretProviderId): Promise<string | null>;
  getStatus(providerId: LlmSecretProviderId): Promise<LlmSecretStatus>;
  setApiKey(providerId: LlmSecretProviderId, apiKey: string): Promise<void>;
};

export type SystemCredentialAdapter = {
  kind?: string;
  deletePassword(service: string, account: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { stdin?: string },
) => Promise<{ stderr: string; stdout: string }>;

export type LlmSecretStoreOptions = {
  adapter?: SystemCredentialAdapter;
  env?: Record<string, string | undefined>;
};

const serviceName = "ghostwriter";
const legacyServiceName = "simple-ai-agent";

const providerSettings: Record<
  LlmSecretProviderId,
  { account: string; envKey: string; legacyAccount: string }
> = {
  anthropic: {
    account: "ghostwriter/anthropic",
    envKey: "ANTHROPIC_API_KEY",
    legacyAccount: "simple-ai-agent/anthropic",
  },
  deepseek: {
    account: "ghostwriter/deepseek",
    envKey: "DEEPSEEK_API_KEY",
    legacyAccount: "simple-ai-agent/deepseek",
  },
  gemini: {
    account: "ghostwriter/gemini",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    legacyAccount: "simple-ai-agent/gemini",
  },
  openai: {
    account: "ghostwriter/openai",
    envKey: "OPENAI_API_KEY",
    legacyAccount: "simple-ai-agent/openai",
  },
  "openai-compatible": {
    account: "ghostwriter/openai-compatible",
    envKey: "GHOSTWRITER_OPENAI_COMPATIBLE_API_KEY",
    legacyAccount: "simple-ai-agent/openai-compatible",
  },
};

function getEnvApiKey(
  env: Record<string, string | undefined>,
  providerId: LlmSecretProviderId,
): string | undefined {
  if (isPackagedDesktopRuntime(env)) {
    return undefined;
  }

  const value = env[providerSettings[providerId].envKey];
  return value && value.length > 0 ? value : undefined;
}

function maskSuffix(apiKey: string): string | undefined {
  if (!apiKey) {
    return undefined;
  }

  return apiKey.slice(-4);
}

function envConfiguredError(providerId: LlmSecretProviderId): Error {
  return new Error(
    `${providerSettings[providerId].envKey} is configured by environment variable and cannot be changed from the app`,
  );
}

function adapterAccount(providerId: LlmSecretProviderId): string {
  return providerSettings[providerId].account;
}

function legacyAdapterAccount(providerId: LlmSecretProviderId): string {
  return providerSettings[providerId].legacyAccount;
}

async function getStoredApiKey(
  adapter: SystemCredentialAdapter,
  providerId: LlmSecretProviderId,
): Promise<string | null> {
  return (
    (await adapter.getPassword(serviceName, adapterAccount(providerId))) ??
    (await adapter.getPassword(legacyServiceName, legacyAdapterAccount(providerId)))
  );
}

function normalizeCredentialOutput(stdout: string): string | null {
  const value = stdout.trimEnd();
  return value.length > 0 ? value : null;
}

function isMissingCredentialError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /could not be found|not found|element not found|1168|credentials? cannot be found/i.test(
    error.message,
  );
}

export function createLlmSecretStore(options: LlmSecretStoreOptions = {}): LlmSecretStore {
  const adapter = options.adapter ?? createSystemCredentialAdapter();
  const env = options.env ?? process.env;

  return {
    async deleteApiKey(providerId) {
      if (getEnvApiKey(env, providerId)) {
        throw envConfiguredError(providerId);
      }

      await adapter.deletePassword(serviceName, adapterAccount(providerId));
    },
    async getApiKey(providerId) {
      const envApiKey = getEnvApiKey(env, providerId);
      if (envApiKey) {
        return envApiKey;
      }

      return getStoredApiKey(adapter, providerId);
    },
    async getStatus(providerId) {
      const envApiKey = getEnvApiKey(env, providerId);
      if (envApiKey) {
        return {
          canDelete: false,
          canUpdate: false,
          isConfigured: true,
          maskedSuffix: maskSuffix(envApiKey),
          providerId,
          source: "env",
        };
      }

      const systemApiKey = await getStoredApiKey(adapter, providerId);
      if (systemApiKey) {
        return {
          canDelete: true,
          canUpdate: true,
          isConfigured: true,
          maskedSuffix: maskSuffix(systemApiKey),
          providerId,
          source: "system",
        };
      }

      return {
        canDelete: false,
        canUpdate: adapter.kind !== "unsupported",
        isConfigured: false,
        providerId,
        source: "missing",
      };
    },
    async setApiKey(providerId, apiKey) {
      if (getEnvApiKey(env, providerId)) {
        throw envConfiguredError(providerId);
      }

      await adapter.setPassword(serviceName, adapterAccount(providerId), apiKey);
    },
  };
}

export function unsupportedSystemCredentialAdapter(platform: string): SystemCredentialAdapter {
  const unsupportedError = () =>
    new Error(
      `OS credential storage is not supported on ${platform}. Supported platforms are macOS and Windows.`,
    );

  return {
    kind: "unsupported",
    async deletePassword() {
      throw unsupportedError();
    },
    async getPassword() {
      return null;
    },
    async setPassword() {
      throw unsupportedError();
    },
  };
}

export function createSystemCredentialAdapter(
  platform: NodeJS.Platform = process.platform,
  commandRunner: CommandRunner = defaultCommandRunner,
): SystemCredentialAdapter {
  if (platform === "darwin") {
    return createMacOSKeychainAdapter(commandRunner);
  }

  if (platform === "win32") {
    return createWindowsCredentialManagerAdapter(commandRunner);
  }

  return unsupportedSystemCredentialAdapter(platform);
}

function createMacOSKeychainAdapter(commandRunner: CommandRunner): SystemCredentialAdapter {
  return {
    kind: "macos-keychain",
    async deletePassword(service, account) {
      try {
        await commandRunner("security", ["delete-generic-password", "-s", service, "-a", account]);
      } catch (error) {
        if (!isMissingCredentialError(error)) {
          throw error;
        }
      }
    },
    async getPassword(service, account) {
      try {
        const result = await commandRunner("security", [
          "find-generic-password",
          "-s",
          service,
          "-a",
          account,
          "-w",
        ]);
        return normalizeCredentialOutput(result.stdout);
      } catch (error) {
        if (isMissingCredentialError(error)) {
          return null;
        }

        throw error;
      }
    },
    async setPassword(service, account, password) {
      await commandRunner("security", [
        "add-generic-password",
        "-U",
        "-s",
        service,
        "-a",
        account,
        "-w",
        password,
      ]);
    },
  };
}

function createWindowsCredentialManagerAdapter(commandRunner: CommandRunner): SystemCredentialAdapter {
  return {
    kind: "windows-credential-manager",
    async deletePassword(service, account) {
      await runWindowsCredentialScript(commandRunner, "delete", service, account);
    },
    async getPassword(service, account) {
      return runWindowsCredentialScript(commandRunner, "get", service, account);
    },
    async setPassword(service, account, password) {
      await runWindowsCredentialScript(commandRunner, "set", service, account, password);
    },
  };
}

async function runWindowsCredentialScript(
  commandRunner: CommandRunner,
  operation: "delete" | "get" | "set",
  service: string,
  account: string,
  password?: string,
): Promise<string | null> {
  const target = `${service}:${account}`;
  const payload = JSON.stringify({ account, operation, password, target });
  const script = `
$ErrorActionPreference = "Stop"
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$signature = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CredMan {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL userCredential, UInt32 flags);

  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

  [DllImport("advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
  public static extern void CredFree(IntPtr buffer);
}
"@
Add-Type -TypeDefinition $signature
$typeGeneric = 1
$persistLocalMachine = 2
if ($payload.operation -eq "get") {
  $credentialPtr = [IntPtr]::Zero
  if (-not [CredMan]::CredRead($payload.target, $typeGeneric, 0, [ref]$credentialPtr)) {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($code -eq 1168) { exit 0 }
    throw "Credential read failed with Windows error $code"
  }
  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($credentialPtr, [type][CredMan+CREDENTIAL])
    if ($credential.CredentialBlobSize -gt 0) {
      $bytes = New-Object byte[] $credential.CredentialBlobSize
      [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $credential.CredentialBlobSize)
      [Console]::Out.Write([Text.Encoding]::Unicode.GetString($bytes))
    }
  } finally {
    [CredMan]::CredFree($credentialPtr)
  }
} elseif ($payload.operation -eq "set") {
  $bytes = [Text.Encoding]::Unicode.GetBytes([string]$payload.password)
  $blob = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
    $credential = New-Object CredMan+CREDENTIAL
    $credential.Type = $typeGeneric
    $credential.TargetName = $payload.target
    $credential.UserName = $payload.account
    $credential.CredentialBlobSize = $bytes.Length
    $credential.CredentialBlob = $blob
    $credential.Persist = $persistLocalMachine
    if (-not [CredMan]::CredWrite([ref]$credential, 0)) {
      $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw "Credential write failed with Windows error $code"
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeCoTaskMem($blob)
  }
} elseif ($payload.operation -eq "delete") {
  if (-not [CredMan]::CredDelete($payload.target, $typeGeneric, 0)) {
    $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($code -ne 1168) {
      throw "Credential delete failed with Windows error $code"
    }
  }
}
`;

  const result = await commandRunner("powershell.exe", [
    "-WindowStyle",
    "Hidden",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], { stdin: payload });

  return operation === "get" ? normalizeCredentialOutput(result.stdout) : null;
}

function defaultCommandRunner(
  command: string,
  args: string[],
  options: { stdin?: string } = {},
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const message = [error.message, stderr].filter(Boolean).join("\n");
        reject(new Error(message));
        return;
      }

      resolve({ stderr, stdout });
    });

    if (options.stdin) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }
  });
}
