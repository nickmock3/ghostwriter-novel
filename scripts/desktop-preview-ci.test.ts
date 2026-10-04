import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

describe("desktop preview CI resilience", () => {
  test("allows a cold Windows sidecar startup", () => {
    const smokeTest = readFileSync("src-tauri/tests/sidecar_smoke.rs", "utf8");

    expect(smokeTest).toContain("Duration::from_secs(60)");
  });

  test("limits GitHub artifact retention", () => {
    const workflow = readFileSync(".github/workflows/desktop-preview.yml", "utf8");
    const uploadSteps = workflow.match(/uses: actions\/upload-artifact@v4/g) ?? [];
    const retentionSettings = workflow.match(/retention-days: 7/g) ?? [];

    expect(uploadSteps).toHaveLength(2);
    expect(retentionSettings).toHaveLength(uploadSteps.length);
  });

  test("selects desktop targets and keeps Windows MSI-free", () => {
    const workflow = readFileSync(".github/workflows/desktop-preview.yml", "utf8");

    expect(workflow).toContain("build-macos:");
    expect(workflow).toContain("build-windows-store-msix:");
    expect(workflow).toContain("Select build_macos and/or build_windows_store_msix");
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).toContain("inputs.build_macos");
    expect(workflow).toContain("inputs.build_windows_store_msix");
    expect(workflow).toContain("needs: validate-dispatch-inputs");
    expect(workflow).toContain("bun run build:desktop:windows:msix");
    expect(workflow).not.toContain("desktop-preview-x86_64-pc-windows-msvc");
    expect(workflow).not.toContain("scripts/package-desktop-preview.ts --target x86_64-pc-windows-msvc");
  });

  test("uploads only the selected macOS preview artifact to R2", () => {
    const workflow = readFileSync(".github/workflows/desktop-preview.yml", "utf8");

    expect(workflow).toContain("needs: build-macos");
    expect(workflow).toContain("inputs.upload_to_r2");
    expect(workflow).toContain("inputs.build_macos");
    expect(workflow).toContain("desktop-preview-aarch64-apple-darwin");
    expect(workflow).not.toContain("desktop-preview-${{ matrix.target }}");
    expect(workflow).not.toContain("upload-desktop-preview-to-r2.ts --target x86_64-pc-windows-msvc");
  });
});
