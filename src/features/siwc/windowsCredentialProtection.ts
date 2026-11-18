import { execFile } from "node:child_process";
import { BoundaryError } from "./result";
import { windowsPowerShell } from "./windowsCredentialPermissions";

export const maxProtectedCredentialBytes = 6 * 1024 * 1024;

// Windows PowerShell 5.1 / .NET Framework. Data travels through pipes, never through arguments.
const protectionScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $data = [Convert]::FromBase64String($request.payload)
  $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($request.operation -eq 'protect') {
    $result = [Security.Cryptography.ProtectedData]::Protect($data, $null, $scope)
  } elseif ($request.operation -eq 'unprotect') {
    $result = [Security.Cryptography.ProtectedData]::Unprotect($data, $null, $scope)
  } else { exit 2 }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { exit 2 }
`;

function runDpapi(operation: "protect" | "unprotect", payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      windowsPowerShell(),
      ["-WindowStyle", "Hidden", "-NoProfile", "-NonInteractive", "-Command", protectionScript],
      { windowsHide: true, timeout: 15_000, maxBuffer: maxProtectedCredentialBytes },
      (error, stdout) => {
        if (error || !stdout) reject(new BoundaryError("storage"));
        else resolve(stdout);
      },
    );
    if (!child.stdin) {
      reject(new BoundaryError("storage"));
      return;
    }
    child.stdin.on("error", () => reject(new BoundaryError("storage")));
    child.stdin.end(JSON.stringify({ operation, payload }));
  });
}

export function protectWindowsCredentialData(plaintext: string): Promise<string> {
  return runDpapi("protect", Buffer.from(plaintext, "utf8").toString("base64"));
}

export async function unprotectWindowsCredentialData(ciphertext: string): Promise<Buffer> {
  return Buffer.from(await runDpapi("unprotect", ciphertext), "base64");
}
