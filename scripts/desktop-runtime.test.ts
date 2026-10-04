import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertHostMatchesTarget,
  assertSupportedDesktopTarget,
  buildSidecarCompileCommand,
  detectExecutableArchitecture,
  detectExecutableArchitectureAtPath,
  detectHostTarget,
  desktopRuntimeTarget,
} from "./desktop-runtime";

function createMachO64Header(cpuType: number): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xfeedfacf, true);
  view.setUint32(4, cpuType, true);
  return bytes;
}

function createPeHeader(machine: number, peOffset = 0x40): Uint8Array {
  const bytes = new Uint8Array(peOffset + 24);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  view.setUint32(0x3c, peOffset, true);
  bytes.set([0x50, 0x45, 0x00, 0x00], peOffset);
  view.setUint16(peOffset + 4, machine, true);
  return bytes;
}

describe("desktop runtime targets", () => {
  it("defines only the supported macOS arm64 and Windows x64 targets", () => {
    expect(Object.keys(desktopRuntimeTarget)).toEqual([
      "aarch64-apple-darwin",
      "x86_64-pc-windows-msvc",
    ]);
    expect(desktopRuntimeTarget["aarch64-apple-darwin"]).toMatchObject({
      bunTarget: "bun-darwin-arm64",
      executableArchitecture: "arm64",
      packagedSidecarFileName: "ghostwriter-sidecar",
      sidecarFileName: "ghostwriter-sidecar-aarch64-apple-darwin",
    });
    expect(desktopRuntimeTarget["x86_64-pc-windows-msvc"]).toMatchObject({
      bunTarget: "bun-windows-x64",
      executableArchitecture: "x64",
      packagedSidecarFileName: "ghostwriter-sidecar.exe",
      sidecarFileName: "ghostwriter-sidecar-x86_64-pc-windows-msvc.exe",
    });
  });

  it("builds sidecar compile commands without bytecode that can corrupt startup", () => {
    const macCommand = buildSidecarCompileCommand(
      "aarch64-apple-darwin",
      "/tmp/ghostwriter-sidecar",
    );
    const windowsCommand = buildSidecarCompileCommand(
      "x86_64-pc-windows-msvc",
      "C:\\tmp\\ghostwriter-sidecar.exe",
    );

    expect(macCommand).toEqual([
      "bun",
      "build",
      "--compile",
      "--minify",
      "src/shared/server/standaloneServer.ts",
      "--outfile",
      "/tmp/ghostwriter-sidecar",
      "--target",
      "bun-darwin-arm64",
    ]);
    expect(windowsCommand).toEqual([
      "bun",
      "build",
      "--compile",
      "--minify",
      "src/shared/server/standaloneServer.ts",
      "--outfile",
      "C:\\tmp\\ghostwriter-sidecar.exe",
      "--target",
      "bun-windows-x64",
      "--windows-hide-console",
    ]);
  });

  it("rejects unsupported desktop targets", () => {
    expect(() => assertSupportedDesktopTarget("x86_64-apple-darwin")).toThrow(
      /unsupported desktop target/i,
    );
    expect(() => assertSupportedDesktopTarget("aarch64-pc-windows-msvc")).toThrow(
      /unsupported desktop target/i,
    );
  });

  it("detects Mach-O arm64 and PE x64 executable headers", () => {
    expect(detectExecutableArchitecture(createMachO64Header(0x0100000c))).toBe("arm64");
    expect(detectExecutableArchitecture(createPeHeader(0x8664))).toBe("x64");
  });

  it("does not accept the excluded architectures", () => {
    expect(detectExecutableArchitecture(createMachO64Header(0x01000007))).toBe("x64");
    expect(detectExecutableArchitecture(createPeHeader(0xaa64))).toBe("arm64");
  });

  it("reads a PE x64 header located at the ripgrep executable offset", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ghostwriter-desktop-runtime-"));
    const executablePath = join(directory, "rg.exe");

    try {
      await writeFile(executablePath, createPeHeader(0x8664, 0x110));

      await expect(detectExecutableArchitectureAtPath(executablePath)).resolves.toBe("x64");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects a PE header offset outside the available bytes", () => {
    const bytes = createPeHeader(0x8664);
    new DataView(bytes.buffer).setUint32(0x3c, bytes.length + 1, true);

    expect(detectExecutableArchitecture(bytes)).toBeNull();
  });

  it("requires the native host for each supported desktop target", () => {
    const hostTarget = detectHostTarget();
    if (hostTarget === "aarch64-apple-darwin") {
      expect(() => assertHostMatchesTarget("aarch64-apple-darwin")).not.toThrow();
      expect(() => assertHostMatchesTarget("x86_64-pc-windows-msvc")).toThrow(
        /requires a native aarch64-apple-darwin runner/i,
      );
      return;
    }

    if (hostTarget === "x86_64-pc-windows-msvc") {
      expect(() => assertHostMatchesTarget("x86_64-pc-windows-msvc")).not.toThrow();
      expect(() => assertHostMatchesTarget("aarch64-apple-darwin")).toThrow(
        /requires a native x86_64-pc-windows-msvc runner/i,
      );
      return;
    }

    expect(hostTarget).toBeNull();
    expect(() => assertHostMatchesTarget("aarch64-apple-darwin")).toThrow(
      /unsupported build host/i,
    );
  });
});
