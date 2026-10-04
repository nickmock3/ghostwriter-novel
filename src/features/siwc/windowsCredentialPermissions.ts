import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { BoundaryError } from "./result";

export const windowsPowerShell = () => join(
  process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
);

// Windows PowerShell 5.1 / .NET Framework: DirectorySecurityを作成時から適用する。
// pathはstdinのJSONデータ。資格情報本文はこのプロセスへ渡さない。
const permissionsScript = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  function Assert-NoReparse([string] $path) {
    $current = $path
    while ($current) {
      try {
        if (([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 3 }
      } catch [IO.FileNotFoundException] {} catch [IO.DirectoryNotFoundException] {}
      $current = [IO.Path]::GetDirectoryName($current)
    }
  }
  function Assert-Private([string] $path, [bool] $directory) {
    Assert-NoReparse $path
    if ($directory) {
      $info = [IO.DirectoryInfo]::new($path)
      if (-not $info.Exists) { exit 3 }
    } else {
      $info = [IO.FileInfo]::new($path)
      if (-not $info.Exists) { exit 3 }
    }
    $acl = $info.GetAccessControl()
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]) -ne $sid) { exit 3 }
    if ($directory -and -not $acl.AreAccessRulesProtected) { exit 3 }
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($rules.Count -ne 1) { exit 3 }
    $rule = $rules[0]
    if ($rule.IdentityReference -ne $sid -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl') { exit 3 }
    if ($directory -and ($rule.InheritanceFlags -ne 'ContainerInherit, ObjectInherit' -or $rule.PropagationFlags -ne 'None')) { exit 3 }
  }
  Assert-NoReparse $request.directory
  if ($request.ensure -and -not [IO.Directory]::Exists($request.directory)) {
    if ([IO.File]::Exists($request.directory)) { exit 3 }
    $security = [Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($sid)
    $security.SetAccessRuleProtection($true, $false)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    $security.AddAccessRule($rule)
    [void][IO.Directory]::CreateDirectory($request.directory, $security)
  }
  Assert-Private $request.directory $true
  if ($request.file) { Assert-Private $request.file $false }
} catch { exit 2 }
`;

export function checkWindowsCredentialPermissions(directory: string, options: { ensure?: boolean; file?: string } = {}): Promise<void> {
  return new Promise((resolveCheck, reject) => {
    const child = execFile(windowsPowerShell(), ["-WindowStyle", "Hidden", "-NoProfile", "-NonInteractive", "-Command", permissionsScript],
      { windowsHide: true, timeout: 15_000, maxBuffer: 4096 }, error => {
        if (error) reject(new BoundaryError(error.code === 3 ? "unsafe_storage" : "storage"));
        else resolveCheck();
      });
    child.stdin?.on("error", () => reject(new BoundaryError("storage")));
    child.stdin?.end(JSON.stringify({ directory: resolve(directory), ensure: Boolean(options.ensure), file: options.file ? resolve(options.file) : null }));
  });
}
