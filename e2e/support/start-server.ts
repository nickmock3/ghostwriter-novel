import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const portIndex = process.argv.indexOf("--port");
const port = portIndex >= 0 ? process.argv[portIndex + 1] : process.env.GHOSTWRITER_E2E_PORT ?? "5173";
const dataRoot = await mkdtemp(path.join(tmpdir(), "ghostwriter-e2e-data-"));
const child = spawn(
  "bun",
  ["run", "dev", "--", "--host", "127.0.0.1", "--port", port, "--strictPort"],
  {
    env: { ...process.env, GHOSTWRITER_DATA_DIR: dataRoot },
    stdio: "inherit",
  },
);

let cleaning = false;
async function stop(signal: NodeJS.Signals) {
  if (cleaning) return;
  cleaning = true;
  child.kill(signal);
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
  await rm(dataRoot, { force: true, recursive: true });
  process.exit(0);
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
child.once("error", async () => {
  if (cleaning) return;
  cleaning = true;
  await rm(dataRoot, { force: true, recursive: true });
  process.exit(1);
});
child.once("exit", async (code, signal) => {
  if (cleaning) return;
  cleaning = true;
  await rm(dataRoot, { force: true, recursive: true });
  process.exit(code ?? (signal ? 1 : 0));
});
