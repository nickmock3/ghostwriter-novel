import { describe, expect, it } from "vitest";
import {
  createDirectoryPickerForPlatform,
  createNativeMacOSDirectoryPicker,
  createNativeWindowsDirectoryPicker,
} from "./workspacePicker";

describe("createNativeMacOSDirectoryPicker", () => {
  it("returns the selected path from osascript stdout", async () => {
    const picker = createNativeMacOSDirectoryPicker(async (command, args) => {
      expect(command).toBe("osascript");
      expect(args).toEqual([
        "-e",
        'POSIX path of (choose folder with prompt "ワークスペースを選択してください")',
      ]);

      return {
        exitCode: 0,
        stderr: "",
        stdout: "/Users/example/project\n",
      };
    });

    await expect(picker.selectDirectory()).resolves.toBe("/Users/example/project");
  });

  it("reports stderr when native selection fails", async () => {
    const picker = createNativeMacOSDirectoryPicker(async () => ({
      exitCode: 1,
      stderr: "User canceled.\n",
      stdout: "",
    }));

    await expect(picker.selectDirectory()).rejects.toThrow("User canceled.");
  });
});

describe("createDirectoryPickerForPlatform", () => {
  it("uses osascript on macOS", async () => {
    const picker = createDirectoryPickerForPlatform("darwin", async (command) => {
      expect(command).toBe("osascript");

      return {
        exitCode: 0,
        stderr: "",
        stdout: "/Users/example/project\n",
      };
    });

    await expect(picker.selectDirectory()).resolves.toBe("/Users/example/project");
  });

  it("uses PowerShell on Windows instead of osascript", async () => {
    const picker = createDirectoryPickerForPlatform("win32", async (command) => {
      expect(command).toBe("powershell.exe");

      return {
        exitCode: 0,
        stderr: "",
        stdout: "C:\\Users\\example\\novel\n",
      };
    });

    await expect(picker.selectDirectory()).resolves.toBe("C:\\Users\\example\\novel");
  });
});

describe("createNativeWindowsDirectoryPicker", () => {
  it("returns the selected path from PowerShell stdout", async () => {
    const picker = createNativeWindowsDirectoryPicker(async (command, args) => {
      expect(command).toBe("powershell.exe");
      expect(args).toEqual([
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        expect.stringContaining("System.Windows.Forms.FolderBrowserDialog"),
      ]);

      return {
        exitCode: 0,
        stderr: "",
        stdout: "D:\\Writing\\Novel\n",
      };
    });

    await expect(picker.selectDirectory()).resolves.toBe("D:\\Writing\\Novel");
  });

  it("reports cancellation when the dialog returns no path", async () => {
    const picker = createNativeWindowsDirectoryPicker(async () => ({
      exitCode: 0,
      stderr: "",
      stdout: "",
    }));

    await expect(picker.selectDirectory()).rejects.toThrow(
      "Native workspace picker returned no workspace",
    );
  });

  it("reports a generic failure when PowerShell exits unsuccessfully", async () => {
    const picker = createNativeWindowsDirectoryPicker(async () => ({
      exitCode: 1,
      stderr: "Add-Type : Cannot add type. Exception stack...",
      stdout: "",
    }));

    await expect(picker.selectDirectory()).rejects.toThrow(
      "Native workspace picker failed",
    );
  });
});
