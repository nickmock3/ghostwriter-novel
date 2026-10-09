import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLlmProviderPlugins } from "./features/llm/modelProvider";

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function envKeysFromExample(envExample: string): Set<string> {
  return new Set(
    envExample
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=", 1)[0]),
  );
}

describe("repository documentation", () => {
  it("documents package scripts with matching commands", async () => {
    const [readme, packageJsonText] = await Promise.all([
      readText("README.md"),
      readText("package.json"),
    ]);
    const packageJson = JSON.parse(packageJsonText) as { scripts: Record<string, string> };

    for (const scriptName of Object.keys(packageJson.scripts)) {
      expect(readme).toContain(`bun run ${scriptName}`);
    }

    expect(readme).toContain("`bun test` はこのプロジェクトのVitest設定を通らないため使いません");
  });

  it("keeps .env.example aligned with supported provider environment keys", async () => {
    const [readme, envExample] = await Promise.all([
      readText("README.md"),
      readText(".env.example"),
    ]);
    const envKeys = envKeysFromExample(envExample);
    const providers = createLlmProviderPlugins({
      config: {
        providers: {
          anthropic: {},
          deepseek: {},
          gemini: {},
          openai: {},
          "openai-compatible": {},
        },
      },
    });

    for (const provider of providers) {
      expect(envKeys).toContain(provider.envKey);
      expect(readme).toContain(provider.envKey);

      for (const model of provider.models) {
        expect(readme).toContain(model.id);
      }
    }

    expect(envKeys).toEqual(
      new Set([
        "ANTHROPIC_API_KEY",
        "DEEPSEEK_API_KEY",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "OPENAI_API_KEY",
        "GHOSTWRITER_OPENAI_COMPATIBLE_API_KEY",
        "GHOSTWRITER_ANTHROPIC_BASE_URL",
        "GHOSTWRITER_DEEPSEEK_BASE_URL",
        "GHOSTWRITER_DEFAULT_MODEL",
        "GHOSTWRITER_DEFAULT_PROVIDER",
        "GHOSTWRITER_GEMINI_BASE_URL",
        "GHOSTWRITER_DATA_DIR",
        "GHOSTWRITER_MAX_AGENTS_MD_BYTES",
        "GHOSTWRITER_OPENAI_BASE_URL",
        "GHOSTWRITER_OPENAI_COMPATIBLE_BASE_URL",
        "GHOSTWRITER_OPENAI_COMPATIBLE_MODELS",
        "GHOSTWRITER_OPENAI_COMPATIBLE_TOOL_MODELS",
        "CLOUDFLARE_ACCOUNT_ID",
        "R2_BUCKET",
        "R2_PUBLIC_BASE_URL",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
      ]),
    );
  });

  it("keeps documentation examples free of secrets and private paths", async () => {
    const [readme, envExample] = await Promise.all([
      readText("README.md"),
      readText(".env.example"),
    ]);
    const combinedDocs = `${readme}\n${envExample}`;

    expect(combinedDocs).not.toMatch(/sk-[A-Za-z0-9_-]{12,}/);
    expect(combinedDocs).not.toContain("/Users/");
    expect(combinedDocs).not.toContain("C:\\Users\\");
  });

  it("documents architecture boundaries for derived projects", async () => {
    const [readme, architecture] = await Promise.all([
      readText("README.md"),
      readText("docs/architecture.md"),
    ]);

    expect(readme).toContain("docs/architecture.md");

    // Keep the architecture link and boundary paths discoverable; prose is reviewed separately.
    for (const requiredReference of [
      "src/features/workspace/workspaceFileStore.ts",
      "src/features/workspace/workspaceSearchStore.ts",
      "src/features/llm/modelProvider.ts",
      "src/features/ai-agent/agentProfiles.ts",
      "src/features/ai-agent/tools/agentTools.ts",
      "src/features/edit-proposals/editProposalService.ts",
      "bun run test",
    ]) {
      expect(architecture).toContain(requiredReference);
    }

    expect(architecture).toContain("```mermaid");
  });
});
