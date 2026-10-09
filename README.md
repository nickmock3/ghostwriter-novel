# Ghostwriter

ローカル小説執筆ワークスペース内の原稿、設定資料、執筆メモなどを対象に、ファイルツリー、CodeMirrorエディター、AIチャットの3ペインで閲覧・編集・検索・AI執筆支援を行うWebエディターです。

Bun、React、TanStack Start、Vercel AI SDK、LLM providerプラグイン、OSシークレットストア、再利用可能なワークスペーステンプレートを使っています。このリポジトリは、単体アプリとして使うだけでなく、別のAIエージェント付きエディターを作るための雛形としても使う想定です。

## 初回セットアップ

必要なもの:

- Bun
- ローカルの `rg` / ripgrep
- 設定画面からLLM APIキーを保存する場合は macOS または Windows

依存関係をインストールします。

```sh
bun install
```

環境変数でAPIキーや既定モデルを設定したい場合は、ローカル用の環境変数ファイルを作成します。

```sh
cp .env.example .env.local
```

`.env.local` は公開しないでください。実APIキーはREADME、`.env.example`、ワークスペース内ファイル、テンプレート、会話履歴、ブラウザストレージへ書き込まないでください。

## ChatGPTプランでの接続（実験版）

SIWC previewを有効にした環境では、設定の「ChatGPTでログイン」が最初の接続方法です。APIキーやCodexの導入は不要です。有効化・対応環境は[SIWC検証手順](specs/siwc-responses-migration.md#ローカル確認手順macos)を参照してください。macOS・Windowsの確認済み結果と公開前の残作業は[SIWC検証と公開状況](docs/siwc-validation-status.md)を参照してください。通常配布での既定有効化は未実施です。

新規利用者はチャット・AIアシストで「ChatGPTプラン」が選ばれ、ログイン後に取得したモデルで利用できます。既存の接続設定は維持します。接続・モデルを変更したい保存済みChatGPT会話では、新規会話を開始してください。認証・利用枠エラーでもAPIキー接続へ自動変更しません。APIキー接続も設定できます。旧Codex CLI連携は撤去しました。過去の会話は閲覧できますが、続行するには新しい会話で接続を選択してください。

チャットの自動編集は適用済みカードのUndoで戻せます。AIアシストは提案を確認してApplyし、同じ結果カードからUndoできます。

## 開発

開発サーバーを起動します。

```sh
bun run dev
```

Vitestの全体テストを実行します。

```sh
bun run test
```

開発中は対象を絞って実行できます。完了時は上記の全体テストを実行してください。

```sh
bun run test src/features/ai-chat/agentChatApi.test.ts
bun run test --project node
bun run test --project dom
```

Vitest設定は `vitest.config.ts` に独立させています。Nodeで実行できるテストにはjsdomを起動せず、`*.test.tsx` / `*.spec.tsx` と設定内の `domTests` に指定したブラウザAPI依存のテストだけをDOM環境で実行します。`.test.ts` でもReact hook、`localStorage`、`window.location`などを使う場合は `domTests` に追加してください。両プロジェクトは全体実行に含まれ、テストファイル間の隔離は維持します。

ブラウザE2Eテストを実行します。

```sh
bun run test:e2e
```

TypeScriptの型チェックを実行します。

```sh
bun run typecheck
```

単体テスト・結合テストは `bun run test` を使ってください。`bun test` はこのプロジェクトのVitest設定を通らないため使いません。

## 本番ランタイム

デスクトップ向けの静的SPAを `dist/client/` に生成します。

```sh
bun run build
```

既存の `/api/*` と `/health` を提供するstandalone APIサーバーを、ループバックアドレス上で起動します。

```sh
bun run start:server
```

## デスクトップ開発

Tauri開発用の静的SPAを生成します。

```sh
bun run build:desktop:web
```

Tauriシェルと認証付きローカルsidecarを開発モードで起動します。開発時はBunと`PATH`上の`rg`を使います。

```sh
bun run desktop:dev
```

デスクトップbundleは対象targetを明示してbuildします。macOS IntelとWindows ARM64は対象外です。

```sh
bun run build:desktop:mac
bun run build:desktop:windows:msix
```

runtime artifactの準備と検証だけを行う場合:

```sh
bun run prepare:desktop:runtime aarch64-apple-darwin
bun run validate:desktop:runtime aarch64-apple-darwin
```

`bun run desktop:build` は未対応 target の生成を避けるため失敗します。macOS Apple Silicon では `build:desktop:mac`、Windows x64 のStore MSIX用release binaryでは `build:desktop:windows:msix` を使ってください。このWindows buildはTauriの`--no-bundle`を使うため、MSI/WiX installerを生成しません。

### デスクトップ実機確認 (035)

Bunと`rg`が`PATH`に無い環境で配布物を起動し、次を確認してください。

1. アプリが起動する。
2. Glob / Grep / Search が動作する。
3. APIキーの保存、取得、削除が macOS Keychain または Windows Credential Manager で動作する。
4. シェルに LLM APIキー環境変数が設定されていても、配布版はOS資格情報ストアのキーを使い、設定ページで「環境変数で設定済み」と表示されない。
5. APIキー本文が WebView 応答、ログ、会話履歴 JSON に出ない。

詳細手順は [src-tauri/README.md](src-tauri/README.md) を参照してください。

Rustのsidecar smoke testとdesktop transport関連テストを実行します。

```sh
bun run test:desktop
```

## 未署名デスクトップ preview 配布

初回のデスクトップ配布は、限定テスター向けの**未署名preview**です（初回previewの履歴上のversionは `0.1.0-preview.1`）。一般配布向けの署名済みreleaseではありません。macOSでは**Gatekeeper**警告、Windowsでは**SmartScreen**警告が表示される前提で運用します。macOSのコード署名・notarizationとStore外Windows code signingはタスク`054`、macOSとStore外WindowsのTauri auto updaterはタスク`055`で扱います。Microsoft Store版WindowsはStoreの署名と更新配信を利用します。

対象platformは次の2つだけです。

- macOS Apple Silicon: `aarch64-apple-darwin`（`.app.tar.gz`）
- Windows x64: `x86_64-pc-windows-msvc`（Microsoft Store提出用のMSIX）

macOS Intel（`x86_64-apple-darwin`）とWindows ARM64（`aarch64-pc-windows-msvc`）向けartifactは生成しません。

アプリケーションバージョンの正本は `package.json` の `version` だけです。macOS preview artifact名、R2 path、Tauri/Cargo metadata、Windows Store MSIX versionは、この正本から生成・検証されます。

### バージョン管理

```sh
# 正本と同期対象metadataを一括更新
bun run version:set <version>

# 不整合を検出（不整合時は非ゼロ終了）
bun run version:check
```

`<version>` は `x.y.z` または `x.y.z-preview.n` のみ受け付けます。空白、 `v` 接頭辞、build metadata、その他のpre-release、leading zero、 `preview.0` / `preview.999` 以上は拒否されます。

tag pushでDesktop Preview workflowを起動する場合は、git tag（例: `v<version>`）が `package.json.version` と一致している必要があります。`version:check` はtag push時に自動でtag一致も検証します。手動起動（`workflow_dispatch`）ではtag一致は要求しません。

リリース手順の例:

```sh
bun run version:set <version>
bun run version:check
git add package.json src-tauri/
git commit -m "chore: release <version>"
git tag v<version>
git push && git push origin v<version>
```

`version:set` はcommit、tag、push、R2 uploadを自動実行しません。

### Legacy Windows MSI metadata

`src-tauri/tauri.windows.conf.json` に残るMSI/WiX metadataは旧packageとの互換確認用です。Desktop Preview workflowおよびStore releaseではこのbundleを実行せず、Windowsは`build:desktop:windows:msix`のno-bundle buildからMSIXだけを作ります。

| 正本（SemVer） | MSI内部version | 説明 |
| --- | --- | --- |
| `x.y.z-preview.n` | `x.y.(z*1000+n)` | preview番号 `n` は 1〜998 |
| `x.y.z`（stable） | `x.y.(z*1000+999)` | stableは同一patch帯のpreviewより常に大きい |

例:

- `0.1.0-preview.1` → `0.1.1`
- `0.1.0-preview.2` → `0.1.2`
- `0.1.0`（stable） → `0.1.999`
- `0.1.1-preview.1` → `0.1.1001`
- `0.2.0-preview.1` → `0.2.1`

MSIの `ProductVersion` は major/minor が最大255、build（3番目）が最大65535です。このリポジトリでは patch は最大64、preview番号は最大998とし、範囲を超える `version:set` / MSI変換は失敗します。patchを上げるとMSI buildの基数（`patch*1000`）が増え、minorを上げるとMSIのminorフィールドが増えます。

MSIはCI artifact、preview配布、R2 uploadのいずれにも使いません。

### Microsoft Store向けMSIX

Windows x64の一般リリース用にはPartner CenterのPackage Identityを持つMSIXを生成します。先にMSIX用のno-bundle Windows buildを完了させてから実行します。CIとrelease手順ではMSI/WiX installerを生成しません。

```powershell
bun run build:desktop:windows:msix
bun run package:windows:msix
bun run validate:windows:msix
```

出力先は`dist/windows-msix/Ghostwriter_<MSIX-version>_x64.msix`です。生成スクリプトはTauri本体、sidecar、同梱`rg.exe`、manifest、44px/150px visual assetを固定layoutへ集め、Windows SDKの`MakeAppx.exe`でパッケージした後、再展開して内容を検証します。Windows SDKが標準位置にない場合は`MAKEAPPX_PATH`で`MakeAppx.exe`の絶対pathを指定できます。

Microsoft Store用MSIX versionはstable SemVerの`x.y.z`だけを`x.y.z.0`へ変換します。preview versionはRevisionが非ゼロになるため、MSIX生成前に拒否します。MSIXのmajorは`1`以上、major/minor/patchは各`0`〜`65535`です。これはMSIの3要素version変換とは別規則であり、MSIの既存変換は変更しません。

生成されるMSIXはMicrosoft Store提出用の**未署名artifact**です。Partner CenterでMicrosoftの署名を受けるため、自前の有料コード署名証明書は必要ありません。この未署名artifactはそのままローカルインストールできません。sideload試験では、manifestのPublisherと同じsubjectを持つ一時的なテスト証明書をワークスペース外で作成し、Windows SDKの`SignTool.exe`でテスト用コピーだけを署名してください。証明書、PFX、password、秘密鍵はリポジトリやGitHub Actions artifactへ保存しません。

会話履歴、設定、Credential ManagerのsecretがStore更新時に保持されることは、Store提出前のWindows実機検証で確認します。

自己署名証明書を使ったローカルsideload、実機機能確認、更新、クリーンアップは[`docs/windows-msix-sideload-checklist.md`](docs/windows-msix-sideload-checklist.md)に従います。

### CI build

GitHub Actions workflow [`.github/workflows/desktop-preview.yml`](.github/workflows/desktop-preview.yml) は、`v*` tag pushではmacOS previewとWindows Store MSIXの両方をbuildします。手動実行では`build_macos`と`build_windows_store_msix`から少なくとも一方を選択します。通常の`main` pushでは重いデスクトップbuildを実行しません。各runnerへ `ripgrep` をインストールしたうえで `bun run version:check`、`bun run test`、`bun run typecheck`、`bun run test:desktop`、target別のbuildを実行します。macOSだけが`.app` preview artifactと`SHA256SUMS`を7日間保存し、Windowsは`windows-store-msix` artifactを7日間保存します。

### Cloudflare R2 path convention

preview artifactは、Cloudflare R2 上で次のpath conventionに従います（`<version>` は `package.json.version`）。

| 種別 | path例 |
| --- | --- |
| versioned artifact | `ghostwriter/preview/versions/<version>/aarch64-apple-darwin/<file>` |
| latest artifact | `ghostwriter/preview/latest/aarch64-apple-darwin/<file>` |
| versioned checksum | `ghostwriter/preview/versions/<version>/SHA256SUMS` |
| latest checksum | `ghostwriter/preview/latest/SHA256SUMS` |

公開URLは `R2_PUBLIC_BASE_URL` とobject keyを連結して参照します。ダウンロード前に `SHA256SUMS` でchecksumを確認してください。

### 手動更新（auto updaterなし）

初回previewではアプリ内の自動更新はありません。新しいpreviewを入手したら、R2上のversioned pathまたはlatest pathからartifactを**手動ダウンロード**し、既存のインストールを置き換えてください。

### R2アップロード

tag pushではR2へアップロードしません。`workflow_dispatch` で`build_macos: true`および `upload_to_r2: true` を指定した場合だけ、GitHub Actions secretsを使ってmacOS preview artifactをアップロードします。Windows Store MSIXはPartner Center提出用artifactであり、R2へアップロードしません。

ローカルまたはCIで使う環境変数 / GitHub secrets:

| 名前 | 用途 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `R2_BUCKET` | 配布先R2 bucket名 |
| `R2_PUBLIC_BASE_URL` | 公開ベースURL（末尾スラッシュなし） |
| `R2_ACCESS_KEY_ID` | R2のS3互換Access Key ID |
| `R2_SECRET_ACCESS_KEY` | R2のS3互換Secret Access Key |

アップロードスクリプトはR2のS3互換APIへ直接PUTします。`R2_ACCESS_KEY_ID` と `R2_SECRET_ACCESS_KEY` は、R2 API token作成後に表示されるAccess Key ID / Secret Access Keyを設定してください。値は `.env.local` または GitHub Actions secrets にだけ置き、リポジトリ・ログ・artifactへ平文保存しないでください。

ローカルでpackageとアップロードする例:

```sh
bun run build:desktop:mac
bun run scripts/package-desktop-preview.ts --target aarch64-apple-darwin
# .env.local に CLOUDFLARE_* / R2_* を設定したうえで:
bun run scripts/upload-desktop-preview-to-r2.ts --target aarch64-apple-darwin
```

R2 tokenやbucket設定だけを先に確認したい場合は、GitHub Actionsの **R2 Smoke** workflowを手動実行してください。これは小さい `ghostwriter/smoke/smoke.txt` だけをR2へアップロードし、公開URLをログへ出します。

R2 bucket名の実値は `R2_BUCKET` で指定します。

## ワークスペースを開く

1. `bun run dev` で開発サーバーを起動します。
2. ブラウザでアプリを開きます。
3. エディター画面のワークスペース操作から、既存のローカルフォルダを開くか、新しいワークスペースを作成します。
4. 新しいワークスペースを作成する場合は、空のワークスペースまたはワークスペーステンプレートを選択します。

内蔵ワークスペーステンプレートは次の項目を作成します。

- `AGENTS.md`
- `notes/`
- `tasks/`
- `tasks/open/`
- `tasks/done/`

既存ワークスペースはそのまま開きます。テンプレートは、新規ワークスペース作成時に明示的に選択した場合だけ適用されます。

## LLM Provider設定

対応しているprovider IDとmodel IDは次のとおりです。

- `deepseek`: `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-flash`
- `openai`: `gpt-5.4-mini`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`
- `gemini`: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`, `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-3.1-pro`, `gemini-3.1-flash`
- `anthropic`: `claude-sonnet-4-6`, `claude-opus-4-7`, `claude-haiku-4-5`, `claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-opus-5`, `claude-opus-5-5`, `claude-fable-5-1`
- `openai-compatible`: `local-model`、または `GHOSTWRITER_OPENAI_COMPATIBLE_MODELS` で指定したmodel ID

非廃止の既存モデルIDは互換のため候補に残しています。退役済みの `deepseek-v4-flash` も互換ルーティングが続く間は保存済み設定のため残します。内蔵プリセットは最新推奨モデルを使います。OpenAIのGPT-6系はResponses APIで実行し、reasoning時は `temperature` などのsamplingパラメータを送信しません。DeepSeekの `deepseek-flash` は既定のthinking modeで `temperature` が効かないため送信しません。Geminiの `gemini-3.8-flash`、`gemini-3.7-flash`、`gemini-3.6-flash` と `gemini-3.5-flash-lite`、AnthropicのClaude Opus 4.7以降のモデル（`claude-opus-4-7`、`claude-fable-5`、`claude-fable-5-1`、`claude-opus-4-8`、`claude-sonnet-5`、`claude-opus-5`、`claude-opus-5-5`）はAPIが `temperature` などのsamplingパラメータを拒否するため、実行時は送信しません。

4社が新しいAPIモデルを公開したときの調査、テスト、実装、文書同期は [LLMモデルカタログ更新手順](docs/llm-model-catalog-update.md) に従います。ChatGPTプランの動的モデルとOpenAI互換providerはこの固定カタログ更新の対象外です。

APIキー用の環境変数:

- `DEEPSEEK_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GHOSTWRITER_OPENAI_COMPATIBLE_API_KEY`

任意のbase URL上書き用環境変数:

- `GHOSTWRITER_DEEPSEEK_BASE_URL`
- `GHOSTWRITER_OPENAI_BASE_URL`
- `GHOSTWRITER_GEMINI_BASE_URL`
- `GHOSTWRITER_ANTHROPIC_BASE_URL`
- `GHOSTWRITER_OPENAI_COMPATIBLE_BASE_URL`
- `GHOSTWRITER_OPENAI_COMPATIBLE_MODELS`
- `GHOSTWRITER_OPENAI_COMPATIBLE_TOOL_MODELS`

任意の既定モデル選択:

- `GHOSTWRITER_DEFAULT_PROVIDER`
- `GHOSTWRITER_DEFAULT_MODEL`

既定値を設定しない場合、アプリは `deepseek` / `deepseek-v4-pro` を使います。

`GHOSTWRITER_*` が正式な環境変数名です。旧 `SIMPLE_AI_AGENT_*` は互換のため読み取りだけ継続し、新旧の両方が設定されている場合は `GHOSTWRITER_*` を優先します。

APIキーの解決は実行形態で変わります。

- Web開発版と `desktop:dev`: 環境変数 → OSシークレットストア → 未設定
- デスクトップ配布版: OSシークレットストア → 未設定

Web開発版と `desktop:dev` では、上記のAPIキー用環境変数を `.env` またはシェル環境変数から設定できます。デスクトップ配布版では、Finderやスタートメニューから起動したアプリへシェル環境変数が一致して渡らないため、LLM APIキー環境変数は無視し、設定ページから macOS Keychain または Windows Credential Manager へ保存したキーのみを使います。base URL、既定provider/model、sidecar認証、アプリデータディレクトリ、同梱 `ripgrep` などAPIキー以外の `GHOSTWRITER_*` 環境変数は、配布版でも引き続き利用できます。

設定ページでは、macOS Keychain または Windows Credential Manager にproviderごとのAPIキーを保存できます。LinuxのOSシークレットストア保存はMVP対象外です。Web開発版と `desktop:dev` で環境変数によるAPIキーが設定されている場合、設定ページでは設定済み状態を表示できますが、更新や削除はできません。デスクトップ配布版では、環境変数が設定されていてもOS資格情報ストアのキーを保存・更新・削除できます。

OSシークレットストアのservice/accountは `ghostwriter` / `ghostwriter/<provider>` を使います。旧 `simple-ai-agent` / `simple-ai-agent/<provider>` のcredentialは互換のため読み取りだけ継続し、新旧の両方が存在する場合は `ghostwriter` 側を優先します。

ブラウザ内の設定保存に使う `localStorage` キーは `ghostwriter:*` です。旧 `simple-ai-agent:*` キーは互換のため読み取りだけ継続し、新旧の両方が存在する場合は `ghostwriter:*` を優先します。

シークレットの制約:

- APIキーはサーバー側だけで扱います。
- APIキー本文をクライアントへ送信しません。
- APIキーを `localStorage` へ保存しません。
- APIキーを会話履歴、ワークスペース内ファイル、ワークスペーステンプレート、ドキュメント例へ書き込まないでください。

## ワークスペーステンプレート

アプリのサイドバーから `/templates` のテンプレート管理ページを開けます。ここで、新規ワークスペース用のユーザー定義テンプレートを作成できます。

テンプレートのルール:

- ルート直下のディレクトリを作成できます。
- ワークスペース直下、またはテンプレート内の一層ディレクトリ直下にテキストファイルを作成できます。
- ディレクトリパスは1セグメントだけ許可されます。
- ファイルパスは最大2セグメントまで許可されます。
- `.` から始まる隠しパスセグメントは拒否されます。
- テンプレートファイル本文にNULLバイトを含めることはできません。
- テンプレート適用時に既存ファイルは上書きされません。

テンプレート定義はアプリのメタデータとして保存され、アクティブなワークスペース内には保存されません。

## AGENTS.md

開いたワークスペースのルートに `AGENTS.md` がある場合、サーバーはそれをエージェントへの追加指示として読み込みます。最大読み込みサイズは `GHOSTWRITER_MAX_AGENTS_MD_BYTES` で制御でき、既定値は65536バイトです。

内蔵の新規ワークスペーステンプレートには初期 `AGENTS.md` が含まれますが、既存ワークスペースは自動変更されません。

## 別のAIエディターへ派生させる場合

主要な設計境界とデータフローは [docs/architecture.md](docs/architecture.md) にまとめています。

このリポジトリを別のAIエージェント付きエディターの雛形として使う場合は、次の変更ポイントを確認してください。

- アプリ名とpackageメタデータ: `package.json`、ページタイトル、画面上の文言。
- 内蔵ワークスペーステンプレート: `src/features/workspace/workspaceTemplateStore.ts`。
- 初期 `AGENTS.md` の文面: `workspaceTemplateStore.ts` 内の内蔵テンプレート本文。
- AgentProfile、system prompt、許可ツール、サブエージェント定義: `src/features/ai-agent/agentProfiles.ts`。
  - ここで `agentProfileConfig` の `defaultProfileId` や `subAgentProfileIds`、各 profile の `systemPrompt` と `activeTools` を調整します。
  - 追加したいツール権限やプロンプト差分は、このファイルの profile 定義に閉じ込めてください。
  - `AGENTS.md` は追加の作業指示として使えますが、ファイル境界、承認制編集、tool 権限などの安全ルールは profile や `AGENTS.md` で緩和できません。
- AgentToolPluginとツール構成: `src/features/ai-agent/tools/agentTools.ts`。
- AgentSkillPluginとSkill構成: `src/features/ai-agent/agentSkills.ts`。
  - 派生プロジェクト固有の作業手順やドメイン知識は、`kind: "agent-skill"`、`id`、`displayName`、`createSkills({ workspaceRoot })` を持つ信頼済みローカルpluginとして定義し、`runAgentLoop`の`skillPlugins`へ明示的に渡します。
  - plugin Skillは`ListSkills`と`UseSkill`から組み込みSkillと同じ一覧・有効化経路で扱われますが、tool権限追加や任意コード実行には使われません。`instruction`全文は一覧や会話履歴へ保存しません。
- LLM providerとmodel候補: `src/features/llm/modelProvider.ts`。
- 環境変数読み込み境界: `src/features/llm/runtimeEnv.ts`。
- LLMシークレット保存のservice名とprovider account: `src/features/llm/secrets/llmSecretStore.ts`。
- ワークスペースファイル境界と検索境界: `src/features/workspace/workspaceFileStore.ts`、`src/features/workspace/workspaceSearchStore.ts`。
- UI文言と画面フロー: `src/app/`、`src/features/`、`src/routes/`。
- 挙動変更に対応するテスト: 近くの `*.test.ts` / `*.test.tsx` と `e2e/`。

派生プロダクトで意図的に変える場合を除き、既存の安全設計を維持してください。クライアント入力はZodで検証し、サーバー側でワークスペース相対パスを正規化し、AI編集は承認制にし、provider secretはサーバー側だけで扱い、ファイルツリーと検索ツールの件数制限を守ります。

## License

MIT

仕様の入口は[仕様索引](specs/README.md)です。過去の調査記録と未実装案は現行仕様から分けて案内しています。
