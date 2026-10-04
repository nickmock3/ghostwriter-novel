> 過去の計画・検証記録。2026-10-05の文書整理前の内容を保存したもの。現在の仕様・残作業は[仕様索引](../../specs/README.md)を参照し、この文書の未完了記述を現行要件として扱わない。

# Tauri v2デスクトップ化 影響範囲

## 結論

macOS Apple SiliconとWindows x64向けデスクトップ版は、Tauri v2の静的WebViewと認証付きローカルsidecarを組み合わせる。

配布targetはmacOSの`aarch64-apple-darwin`とWindowsの`x86_64-pc-windows-msvc`だけとする。macOS IntelとWindows ARM64は対象外とする。

既存バックエンドをRustへ全面移植しない。Vercel AI SDK、AIストリーミング、ファイル操作、検索、会話履歴、テンプレート、LLMシークレット管理はTypeScript側に残す。Tauriはウィンドウ、sidecarライフサイクル、ネイティブダイアログ、アプリデータパス、配布を担当する。

## 現状

- `package.json`に本番用`build`、`start`、デスクトップ用scriptがない。
- `/api/*`は`vite.config.ts`の`configureServer`へ直接登録され、Vite開発サーバーでしか起動しない。
- UIは`fetch("/api/...")`で同一origin APIを前提にしている。
- サーバー機能はNode互換APIを使うTypeScriptで、Vercel AI SDKの`streamText`とNDJSONストリーミングを使う。
- ワークスペース選択は`workspacePicker.ts`から`osascript`またはPowerShellを起動する。
- 検索は`workspaceSearchStore.ts`から`rg`を`PATH`検索して起動する。
- APIキーは`llmSecretStore.ts`からmacOS KeychainまたはWindows Credential Managerを操作する。
- 会話履歴とユーザー定義テンプレートは`resolveServerDataRoot`で決まるアプリデータrootへ保存する。未設定時の開発fallbackは`{cwd}/.data`、デスクトップ版sidecarはTauriがOSアプリデータディレクトリを`GHOSTWRITER_DATA_DIR`へ注入する。
- PlaywrightはVite開発サーバーとChromiumを対象にしている。

## 主要な影響範囲

### ビルドとランタイム

Tauriは静的フロントエンドを読み込むため、Vite開発ミドルウェアを本番APIとして使えない。次の分離が必要になる。

- API handler登録を`vite.config.ts`から再利用可能なrouterへ抽出する。
- 独立起動できるローカルHTTPサーバーentry pointを追加する。
- TanStack Startの画面をデスクトップ向け静的SPAとしてbuildできるようにする。
- Bunの単一実行ファイル化または同等の方式で、`aarch64-apple-darwin`と`x86_64-pc-windows-msvc`向けsidecarを生成する。
- Tauriがsidecarを起動し、health check、異常終了表示、アプリ終了時停止を管理する。

### クライアント通信

相対URLへの直接`fetch`をtransport境界へ集約する。

- Web開発版は従来通り同一originの`/api/*`を使う。
- デスクトップ版はTauri起動時に確定したループバックURLを使う。
- sidecarは`127.0.0.1`だけで待ち受け、ランダムな空きportを使う。
- 起動ごとの認証token、Origin検証、CORS制限を入れる。
- チャットのNDJSONストリームと中断処理がデスクトップWebViewでも動くことを検証する。

### ローカル機能

- ワークスペース選択はデスクトップ版だけTauri dialogを使い、選択後のパス検証はsidecarで継続する。
- `WorkspaceFileStore`とパス安全性検証は維持する。Tauriのfs scopeだけを安全性の根拠にしない。
- `ripgrep`を対象platformごとに同梱し、明示された実行パスを検索ストアへ注入する。
- 会話履歴とテンプレートの保存先を`GHOSTWRITER_DATA_DIR`（またはruntime注入`dataRoot`）で指定できる境界を追加する。root変更の自動移行は行わない。
- UI設定、LLMプロフィール、最後に開いたワークスペースは当面WebViewの`localStorage`を継続利用できるが、Tauri identifierとoriginを安定させる。
- APIキーは既存のOS credential実装を初期段階で維持する。Tauri/Rust側へ移す場合もAPIキー本文をWebViewへ返さない専用commandにする。
- デスクトップ配布版ではsidecarへ`GHOSTWRITER_RUNTIME_MODE=desktop-packaged`を注入し、LLM APIキー環境変数を無視してOS資格情報ストアのみを使う。Web開発版と`desktop:dev`では従来どおり環境変数を優先する。

### セキュリティ

- Tauri capabilityはmain windowに必要なdialog、sidecar起動、限定的なprocess操作だけを許可する。
- shell pluginへ任意commandや任意argumentを許可しない。
- CSPはローカルassets、Tauri IPC、認証付きsidecarへの接続だけを許可する。
- 外部LLM APIへの通信はsidecarから行い、WebViewの`connect-src`へproviderのURLを追加しない。
- sidecar APIは入力のZod検証、ワークスペースroot検証、シンボリックリンク脱出拒否を継続する。

### 配布

- macOSはApple Developer ID署名とnotarizationが必要になる。
- WindowsはSmartScreen警告を避けるためコード署名が必要になる。
- macOS Apple SiliconとWindows x64について、Tauri本体、sidecar、`rg`の組み合わせを生成する。
- 自動更新を導入する場合は、署名済み更新artifactとupdate manifestを生成する。
- CIはmacOSとWindowsの各runnerでbuildする。少なくとも単体テスト、sidecar結合テスト、デスクトップ起動smoke testを行う。

### Microsoft Store向けMSIX

- Tauri v2のWindows release成果物を正とし、MSIのインストールキャプチャ変換は行わない。`ghostwriter.exe`、`ghostwriter-sidecar.exe`、同梱`rg.exe`を固定MSIX layoutへ配置し、Partner CenterのIdentityを持つ`AppxManifest.xml`とWindows SDKの`MakeAppx.exe`で再現可能に生成する。
- Package Identityは`RyoHeiguchi.Ghostwriter-Novel`、Publisherは`CN=8A2DE4F5-8A62-43C8-83DF-8E6AD96575D9`、Publisher display nameは`Ryo Heiguchi`とする。Tauri identifierの`com.ghostwriter.app`とは別の識別子として扱う。
- Store提出用MSIX versionは`major.minor.patch.revision`とし、stable SemVerの`x.y.z`を`x.y.z.0`へ変換する。Revisionは常に`0`であり、非ゼロRevisionになるpreview SemVerはMSIX生成前に拒否する。majorは`1`以上、major/minor/patchは各`0`から`65535`の範囲とする。MSIの既存version変換は独立した互換metadataとして維持する。
- manifest capabilityはfull-trust desktop起動に必要な`runFullTrust`だけを宣言し、`broadFileSystemAccess`は追加しない。ユーザーがネイティブダイアログで選択したワークスペースへの通常のWin32アクセスを維持する。
- Store artifactは未署名MSIXとしてCI artifactへ保存し、Partner CenterでのStore署名と配信に渡す。ローカルsideloadでは同じPublisher subjectを持つ一時的なテスト証明書で別途署名し、秘密鍵はリポジトリやCI artifactへ含めない。
- MSI preview版とMSIX Store版は異なるinstaller identityとして技術上併存し得るため、自動移行や自動削除は行わない。正式移行時はMSI版を先にアンインストールする運用とし、アプリデータとCredential Managerの保持可否を実機更新検証で確定する。

## 選択肢

### TypeScript sidecar

既存実装とテストを最も再利用できる。課題はsidecarの生成、プロセス管理、ループバックAPIの保護、配布サイズである。

### Rust/Tauri commandsへ全面移植

ローカルHTTPサーバーを不要にできるが、Vercel AI SDK、ストリーミング、AI tool loop、ファイルサービス、検索、履歴を再実装する必要がある。初期導入としては変更量と回帰リスクが大きすぎる。

### 採用方針

初期導入はTypeScript sidecarを採用する。Tauri固有機能だけをRust/pluginへ置き、必要性が確認できた境界から段階的に移す。

## 変更対象

- `package.json`
- `vite.config.ts`
- TanStack Startのclient/build設定
- `src/shared/server/`
- 各`create*ApiHandler`のrouter登録
- `src/app/App.tsx`
- `src/features/*`のAPI呼び出し
- `src/features/workspace/workspacePicker.ts`
- `src/features/workspace/workspaceSearchStore.ts`
- `src/features/ai-chat/conversationHistory.ts`
- `src/features/workspace/workspaceTemplateStore.ts`
- `src/features/ai-agent/llmSecretStore.ts`
- `playwright.config.ts`
- 新規`src-tauri/`
- 新規desktop build/resource scripts
- 新規macOS/Windows CI

## 未確定事項

- 署名証明書とApple Developer Programの準備状況。
- 自動更新を初回リリースから必須にするか。
- Web版を将来も配布対象として維持するか、開発用途だけにするか。
- sidecar単一実行ファイルの配布サイズ。

## 確定したdesktop runtime layout

- `scripts/desktop-runtime.ts` が target metadata、Mach-O/PE header検証、ripgrep 15.1.0取得、Bun compile、Tauri向け artifact配置を担う。
- 対象targetは `aarch64-apple-darwin` と `x86_64-pc-windows-msvc` のみ。Bun compile targetは `bun-darwin-arm64` と `bun-windows-x64`。
- sidecar external binary名は `ghostwriter-sidecar-<TARGET_TRIPLE>`（Windowsは `.exe` 付き）。
- ripgrepは `src-tauri/runtime-artifacts/ripgrep/<TARGET_TRIPLE>/` に展開し、`runtime-artifacts/ripgrep/current/` を Tauri resource として同梱する。
- release buildでは Tauri が bundled sidecar と `GHOSTWRITER_RG_EXECUTABLE` を sidecarへ注入する。debug buildでは Bun + PATH `rg` を維持する。
- sidecarの作業ディレクトリは、debug build（Bun起動）ではプロジェクトルート、packaged build（同梱実行ファイル起動）ではOSアプリデータrootとする。ビルド元リポジトリの絶対パスや`.env`へ依存しない。
- Bun compileでは、依存moduleとの組み合わせにより起動不能な成果物を生成し得る`--bytecode`を使わない。旧Codex CLI向けMCP hostの準備・再起動は廃止した。

## 参照

- Tauri Frontend Configuration: https://v2.tauri.app/start/frontend/
- Tauri Sidecar: https://v2.tauri.app/develop/sidecar/
- Tauri Node.js Sidecar: https://v2.tauri.app/learn/sidecar-nodejs/
- Tauri Dialog Plugin: https://v2.tauri.app/plugin/dialog/
- Tauri Capabilities: https://v2.tauri.app/security/capabilities/
- Tauri CSP: https://v2.tauri.app/security/csp/
- Tauri macOS Signing: https://v2.tauri.app/distribute/sign/macos/
- Tauri Windows Signing: https://v2.tauri.app/distribute/sign/windows/
- Microsoft Store Policies 10.2.2: https://learn.microsoft.com/en-us/windows/apps/publish/store-policies
- MSIX runtime and app-data guidance: https://learn.microsoft.com/en-us/windows/msix/msix-troubleshooting-guide
