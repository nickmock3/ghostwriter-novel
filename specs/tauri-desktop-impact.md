# Tauri v2デスクトップ仕様

## 結論

macOS Apple SiliconとWindows x64向けデスクトップ版は、Tauri v2の静的WebViewと認証付きローカルsidecarを組み合わせる。

配布targetはmacOSの`aarch64-apple-darwin`とWindowsの`x86_64-pc-windows-msvc`だけとする。macOS IntelとWindows ARM64は対象外とする。

既存バックエンドをRustへ全面移植しない。Vercel AI SDK、AIストリーミング、ファイル操作、検索、会話履歴、テンプレート、LLMシークレット管理はTypeScript側に残す。Tauriはウィンドウ、sidecarライフサイクル、ネイティブダイアログ、アプリデータパス、配布を担当する。

## 実装構成

- Web版はVite、配布版はTauriの静的SPAとBun compileしたsidecarで動作する。
- 共通API routerは`src/shared/server/apiRouter.ts`、独立HTTP entry pointは`src/shared/server/standaloneServer.ts`。Web開発用adapterは`src/shared/server/viteApiPlugin.ts`。
- クライアント通信は`src/shared/client/apiTransport.ts`でWeb同一originとdesktopの認証付きloopbackを切り替える。
- build・MSIX生成・runtime検証コマンドは`package.json`、手順は[README](../README.md)。導入前の調査は[過去記録](../docs/archive/tauri-desktop-impact.md)へ分離した。
- SIWCは[直接接続仕様](siwc-responses-migration.md)に従う。両OSの確認結果・公開状況は[検証状況](../docs/siwc-validation-status.md)を参照する。

## ランタイムの契約

### ビルドとランタイム

Tauriは静的フロントエンドを読み込むため、Vite開発ミドルウェアを本番APIとして使えない。以下の構成を維持する。

- API handler登録は再利用可能な共通routerへ集約する。
- 独立起動できるローカルHTTPサーバーentry pointを使用する。
- TanStack Startの画面をデスクトップ向け静的SPAとしてbuildする。
- Bunの単一実行ファイル化または同等の方式で、`aarch64-apple-darwin`と`x86_64-pc-windows-msvc`向けsidecarを生成する。
- Tauriがsidecarを起動し、health check、異常終了表示、アプリ終了時停止を管理する。

### クライアント通信

API呼出しはtransport境界へ集約する。

- Web開発版は従来通り同一originの`/api/*`を使う。
- デスクトップ版はTauri起動時に確定したループバックURLを使う。
- sidecarは`127.0.0.1`だけで待ち受け、ランダムな空きportを使う。
- 起動ごとの認証token、Origin検証、CORS制限を入れる。
- チャットのNDJSONストリームと中断処理がデスクトップWebViewでも動くことを検証する。

### ローカル機能

- ワークスペース選択はデスクトップ版だけTauri dialogを使い、選択後のパス検証はsidecarで継続する。
- `WorkspaceFileStore`とパス安全性検証は維持する。Tauriのfs scopeだけを安全性の根拠にしない。
- `ripgrep`を対象platformごとに同梱し、明示された実行パスを検索ストアへ注入する。
- 会話履歴とテンプレートの保存先を`GHOSTWRITER_DATA_DIR`（またはruntime注入`dataRoot`）で指定する。root変更の自動移行は行わない。
- UI設定、LLMプロフィール、最後に開いたワークスペースは当面WebViewの`localStorage`を継続利用できるが、Tauri identifierとoriginを安定させる。
- APIキーは既存のOS credential実装を初期段階で維持する。Tauri/Rust側へ移す場合もAPIキー本文をWebViewへ返さない専用commandにする。
- デスクトップ配布版ではsidecarへ`GHOSTWRITER_RUNTIME_MODE=desktop-packaged`を注入し、LLM APIキー環境変数を無視してOS資格情報ストアのみを使う。Web開発版と`desktop:dev`では従来どおり環境変数を優先する。

### セキュリティ

- main windowのcapabilityはsidecar接続取得・再起動、ディレクトリ選択dialog、HTTP(S)外部リンクを開くopenerに限定する。具体値は`src-tauri/capabilities/default.json`を参照する。
- shell pluginへ任意commandや任意argumentを許可しない。
- CSPはローカルassets、Tauri IPC、認証付きsidecarへの接続だけを許可する。
- 外部LLM APIへの通信はsidecarから行い、WebViewの`connect-src`へproviderのURLを追加しない。
- sidecar APIは入力のZod検証、ワークスペースroot検証、シンボリックリンク脱出拒否を継続する。

### 配布

- macOSのコード署名・notarizationとStore外Windows code signingは未完了。初回previewの未署名配布方針と区別する。
- Microsoft Store版WindowsはStoreの署名・更新を使用する。Store外の配布条件と混同しない。
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

## 採用理由

### TypeScript sidecar

既存実装とテストを最も再利用できる。課題はsidecarの生成、プロセス管理、ループバックAPIの保護、配布サイズである。

### Rust/Tauri commandsへ全面移植

ローカルHTTPサーバーを不要にできるが、Vercel AI SDK、ストリーミング、AI tool loop、ファイルサービス、検索、履歴を再実装する必要がある。初期導入としては変更量と回帰リスクが大きすぎる。

### 採用方針

TypeScript sidecarを採用している。Tauri固有機能だけをRust/pluginへ置き、必要性が確認できた境界から段階的に移す。

## 配布の現在の方針

- Web版は開発用途として維持する。
- 初回previewは未署名artifactの手動配布とし、auto updaterは導入しない。macOSとStore外Windows向けのauto updaterは未導入。
- Windowsの一般リリースはMicrosoft Store用MSIXとする。Store署名と更新を使い、sideload検証用の署名コピーとは分離する。
- 現行StoreのPackage Identity・Publisher・表示名はOSS化後も保持する。鍵・資格情報は公開しない。
- 最新の表示だけを変えた場合は配布画面の確認に絞り、OS境界を変更していないのに両OSの認証・保存検証をやり直さない。

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
