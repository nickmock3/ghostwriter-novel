# Ghostwriter Tauri shell

## Development prerequisites

- Bun on `PATH` (launches `src/shared/server/standaloneServer.ts` as the authenticated sidecar)
- local `rg` on `PATH` (web-style search fallback during development)
- Rust toolchain via `cargo`

Development mode keeps the Bun sidecar and PATH-based `rg`. Packaged builds use a compiled sidecar external binary and a bundled `rg` resource.

## Useful commands

```sh
bun run build:desktop:web
bun run desktop:dev
bun run test:desktop
```

## Desktop runtime packaging

Supported targets only:

- `aarch64-apple-darwin`
- `x86_64-pc-windows-msvc`

macOS Intel (`x86_64-apple-darwin`) and Windows ARM64 (`aarch64-pc-windows-msvc`) are rejected.

Prepare runtime artifacts for an explicit target:

```sh
bun run scripts/desktop-runtime.ts prepare --target aarch64-apple-darwin
bun run scripts/desktop-runtime.ts prepare --target x86_64-pc-windows-msvc
```

Validate sidecar and ripgrep headers before packaging:

```sh
bun run scripts/desktop-runtime.ts validate --target aarch64-apple-darwin
```

Build a desktop bundle for a supported target:

```sh
bun run build:desktop:mac
bun run build:desktop:windows:msix
```

`bun run desktop:build` intentionally fails. The Windows MSIX build uses Tauri `--no-bundle` to produce the release executable and runtime resources without generating an MSI/WiX installer.

Runtime artifacts are written under `src-tauri/runtime-artifacts/` and are gitignored. They are not committed.

## Debug stubs vs release artifacts

`src-tauri/build.rs` writes Rust-only Mach-O/PE header stubs when debug/test builds need `externalBin` or resource files on a clean checkout. Release builds fail instead of generating stubs, and `prepare-for-tauri-build` must produce validated real sidecar and ripgrep artifacts first.

Packaged applications resolve the sidecar at runtime as `ghostwriter-sidecar` on macOS and `ghostwriter-sidecar.exe` on Windows. Build artifacts keep the target-triple suffix required by Tauri `externalBin`.

## Security verification (036)

During development, confirm ACL and CSP stay minimal before packaging.

1. Run `RUST_LOG=tauri=debug bun run desktop:dev` and watch the terminal for capability or command permission denials when opening a workspace or reconnecting to the sidecar.
2. Open the WebView developer tools and check the console for CSP violation reports. External LLM provider URLs must not appear in allowed `connect-src` targets.
3. In the Network tab, confirm API calls go to the authenticated loopback sidecar (`http://127.0.0.1:<port>/api/...`) and that direct `fetch` to external `https://` provider endpoints is blocked.
4. Send an AI chat message and confirm NDJSON streaming still works through the sidecar after CSP hardening.

`unsafe-inline` is allowed only in `style-src`, not in `script-src`. CodeMirror's style-mod injects CSS into runtime `<style>` elements, and the existing UI uses `style` attributes; bundled stylesheets remain covered by `'self'`.

Automated checks: `bunx vitest run scripts/tauri-security.test.ts`.

## Manual verification (035)

Run these checks on a machine without Bun and `rg` on `PATH`.

### macOS Apple Silicon

1. Build with `bun run build:desktop:mac`.
2. Launch the generated `.app` from a shell where `which bun` and `which rg` both fail.
3. Open a workspace and confirm Glob, Grep, and Search work from AI tools.
4. Save, reload, and delete an API key from LLM Provider settings.
5. With LLM API key environment variables set in the launch shell, confirm the packaged app still uses the OS credential store and does not show `source: "env"` in LLM Provider settings.
6. Confirm API key bodies do not appear in WebView responses, app logs, or conversation history JSON under the app data directory.

### Windows x64

1. Build with `bun run build:desktop:windows:msix`, then package with `bun run package:windows:msix`.
2. Launch the installed Store package or its release executable from a shell where `where bun` and `where rg` both fail.
3. Repeat the Glob/Grep/Search and API key save/get/delete checks above.
4. With LLM API key environment variables set in the launch shell, confirm the packaged app still uses the OS credential store and does not show `source: "env"` in LLM Provider settings.
5. Confirm API key bodies do not appear in WebView responses, app logs, or conversation history JSON.

### Secret leakage checks

- `GET /api/llm/secrets` returns masked suffixes only.
- Conversation history files under app data contain no API key strings.
- Desktop logs do not print `GHOSTWRITER_SIDECAR_TOKEN` or provider API keys.
