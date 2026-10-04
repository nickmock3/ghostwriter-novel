import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, loadEnv } from "vite";
import { createProductionApiRouter } from "./src/shared/server/apiRouter";
import { createViteApiMiddlewarePlugin } from "./src/shared/server/viteApiPlugin";

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  const apiRouter = createProductionApiRouter();

  return {
    plugins: [
      tanstackStart({
        spa: {
          enabled: true,
        },
      }),
      react(),
      createViteApiMiddlewarePlugin(apiRouter),
    ],
  };
});
