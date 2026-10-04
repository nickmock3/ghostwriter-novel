import { spawn } from "node:child_process";

export type DirectoryPicker = {
  selectDirectory(): Promise<string>;
};

type CommandResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
type PickerPlatform = NodeJS.Platform;

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const chunks: string[] = [];
  const errorChunks: string[] = [];

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => chunks.push(chunk));
  child.stderr.on("data", (chunk: string) => errorChunks.push(chunk));

  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stderr: errorChunks.join(""),
        stdout: chunks.join(""),
      });
    });
  });
}

export function createNativeMacOSDirectoryPicker(commandRunner: CommandRunner = runCommand): DirectoryPicker {
  return {
    async selectDirectory() {
      const script =
        'POSIX path of (choose folder with prompt "ワークスペースを選択してください")';
      const { exitCode, stdout, stderr } = await commandRunner("osascript", [
        "-e",
        script,
      ]);

      if (exitCode !== 0) {
        throw new Error(stderr.trim() || "Native picker unavailable");
      }

      const selectedPath = stdout.trim();
      if (!selectedPath) {
        throw new Error("Native picker returned no workspace");
      }

      return selectedPath;
    },
  };
}

export function createNativeWindowsDirectoryPicker(commandRunner: CommandRunner = runCommand): DirectoryPicker {
  return {
    async selectDirectory() {
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
        "$dialog.Description = 'ワークスペースを選択してください'",
        "$dialog.ShowNewFolderButton = $true",
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
        "  [Console]::Out.WriteLine($dialog.SelectedPath)",
        "}",
      ].join("; ");
      const { exitCode, stdout } = await commandRunner("powershell.exe", [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ]);

      if (exitCode !== 0) {
        throw new Error("Native workspace picker failed");
      }

      const selectedPath = stdout.trim();
      if (!selectedPath) {
        throw new Error("Native workspace picker returned no workspace");
      }

      return selectedPath;
    },
  };
}

export function createUnsupportedDirectoryPicker(): DirectoryPicker {
  return {
    async selectDirectory() {
      throw new Error(
        "Native workspace picker is unavailable on this platform. Enter an absolute path instead.",
      );
    },
  };
}

export function createDirectoryPickerForPlatform(
  platform: PickerPlatform = process.platform,
  commandRunner: CommandRunner = runCommand,
): DirectoryPicker {
  if (platform === "darwin") {
    return createNativeMacOSDirectoryPicker(commandRunner);
  }

  if (platform === "win32") {
    return createNativeWindowsDirectoryPicker(commandRunner);
  }

  return createUnsupportedDirectoryPicker();
}
