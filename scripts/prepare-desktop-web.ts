import { access, copyFile } from "node:fs/promises";
import { join } from "node:path";

const clientDir = join(import.meta.dir, "..", "dist", "client");
const shellHtml = join(clientDir, "_shell.html");
const indexHtml = join(clientDir, "index.html");

await access(shellHtml);
await copyFile(shellHtml, indexHtml);
console.log("Prepared dist/client/index.html for Tauri");
