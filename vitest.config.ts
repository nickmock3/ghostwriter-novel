import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// TSX tests render UI; these TS tests also need browser APIs or React hooks.
const domTests = [
  "**/*.{test,spec}.tsx",
  "src/app/workspaceSessionStorage.test.ts",
  "src/features/llm/profiles/llmProfileStorage.test.ts",
  "src/features/settings/settingsStorage.test.ts",
  "src/features/ai-assist/useAiAssistExecutionOptions.test.ts",
  "src/features/workspace/workspaceFilesClient.test.ts",
];

// Keep test startup independent of the application server and route generation.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "e2e/**", "dist/**"],
    testTimeout: 15_000,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          exclude: domTests,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: domTests,
          setupFiles: "./src/test/setup.ts",
        },
      },
    ],
  },
});
