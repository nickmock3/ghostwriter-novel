# 238 `ai-agent`からLLM接続・設定を`llm` featureへ分離

## 目的

`src/features/ai-agent/`に同居している「エージェント実行」と「LLM接続・APIキー・LLMプロファイル設定」を分ける。`ai-agent`はエージェントループとツールに集中させ、`ModelProvider`境界とAPIキー管理を新しい`src/features/llm/`へまとめる。製品の挙動は変えない。

## 難易度

- 判定: 中
- 理由: 中心はファイル移動とimport更新だが、`ai-agent`外の約40ファイルから参照されている。APIキー保存（OSシークレットストア）とSIWC接続の境界をまたぐため、移動中にサーバー専用モジュールがクライアントへ混入したり、秘密情報の扱いが変わったりする回帰に注意が要る。`llm`と`siwc`の循環を避ける境界判断も必要。

## 前提

- `236-fix-reverse-feature-dependencies.md`が完了していること。236で`ai-agent`へ移したLLM選択の型（`SelectedModel`、`LlmProviderChoice`など）とモデル選択ロジック・UIも、本タスクで`llm`へ移す。
- `237-enforce-feature-dependency-rules.md`が先に完了している場合は、許可表に`llm`を追加する。

## 現状（`ai-agent`の内訳）

| 区分 | ファイル |
| --- | --- |
| エージェント実行 | `runAgentLoop.ts`、`agentProfiles.ts`、`agentTools.ts`、`agentSkills.ts`、`trustedAgentExtensions.ts`、`agentStreamEvents.ts`、`agentTokenUsage.ts`、`subAgentRuntime.ts` |
| system promptの文脈 | `agentContextLoader.ts`、`workspaceInstructions.ts`、`workspaceStructureContext.ts`、`recentTextFilesContext.ts` |
| 執筆委譲 | `writingDelegationService.ts`、`writingDelegationTarget.ts`、`writingArtifactRegistry.ts`、`streamWritingObject.ts`、`delegateWritingDiagnostics.ts` |
| LLM接続 | `modelProvider.ts`、`modelProviderApi.ts`、`runtimeEnv.ts`、`llmRuntime.ts`、`llm-providers/*` |
| APIキー | `llmSecretStore.ts`、`llmSecretApi.ts` |
| LLMプロファイル | `llmProfiles.ts`、`llmProfileStorage.ts`、`llmProfileApi.ts`、`contextWindow.ts`、`LlmProfilesPage.tsx` |

## 移動後の構成（確定）

```text
src/features/llm/
  modelProvider.ts / modelProviderApi.ts / runtimeEnv.ts / llmRuntime.ts
  providers/        … llm-providers/*（SIWC用アダプタを除く）
  secrets/          … llmSecretStore.ts / llmSecretApi.ts
  profiles/         … llmProfiles.ts / llmProfileStorage.ts / llmProfileApi.ts / contextWindow.ts / LlmProfilesPage.tsx
  selection/        … 236で移したモデル選択の型・ロジック・UI

src/features/ai-agent/
  runAgentLoop.ts / agentProfiles.ts / agentSkills.ts / trustedAgentExtensions.ts / …
  tools/            … agentTools.ts、ai-tools/ripgrepTools.ts（ai-toolsを吸収）
  context/          … system promptの文脈4ファイル
  writing/          … 執筆委譲5ファイル
```

上記のサブディレクトリ構成を採用し、隣接テストも同じ階層へ移す。SIWCのアダプタ・SDK契約テストは`siwc/`直下へ移す。OpenAI SDK生成は`llm/providers/openaiResponses.ts`で行い、SIWC側へSDK生成処理を持ち込まない。

開始時に難易度「中」を再確認。236は完了済み、237は未完了のため、依存許可表の変更は237で扱う。仕様との矛盾はない。

## 境界の判断

- **`llm`と`siwc`の循環を作らない。** 現在`llm-providers/siwcResponses.ts`と`siwcRuntime.ts`は`siwc/`の`service`、`models`、`errors`、`result`を参照し、`siwc/useAiConnection.ts`はLLM選択の型を参照している。そのまま両方を`llm`へ置くと循環になる。
  - 方針: SIWC用アダプタ（`siwcResponses.ts`、`siwcRuntime.ts`）は`siwc/`へ移し、`llm`の`LlmProviderPlugin`などの型に依存させる。`llm/modelProviderApi.ts`の`SiwcService`型への依存は、必要な機能だけを表すインターフェースを`llm`側で定義し、composition root（`src/shared/server/apiRouter.ts`）から実体を渡す形に置き換える。
  - 依存の向きは`workspace → edit-proposals → llm → siwc → ai-agent → ai-chat / ai-assist`とし、`docs/architecture.md`を更新する。
- **`ai-agent`は`ModelProvider`経由でだけLLMを扱う。** `ai-agent`から`llm/secrets`を直接参照しない。APIキー解決は引き続き`llmRuntime`が担う。
- **`ai-tools`の吸収**: `ripgrepTools.ts`はAIツールの入力schemaとRead実装なので`ai-agent/tools/`へ移し、`ai-tools/`を削除する。ツールの返却形と件数制限は変えない。
- `AGENTS.md`の「OpenAI固有処理は`ModelProvider`境界に閉じ込める」に合わせ、`@ai-sdk/*` provider packageのimportは`llm/`だけにする（`src/evals/`とテストを除く）。

## 対象外

- `ai-chat`、`ai-assist`のサブディレクトリ化。
- `src/app/`のLLM関連ロジックの移動（`239-move-domain-logic-out-of-app.md`で扱う）。
- providerの追加・削除、APIの経路やレスポンス形の変更。

## 検証方針

- 挙動を変えない内部整理のため、新規の振る舞いテストは追加しない。既存のVitest、型チェック、Playwright、desktop検証で回帰を検出する。
- 移動したファイルのテストは対象の隣へ一緒に移し、検証内容は変えない。テストを修正する必要が出た場合は、固定している内容が要件かを確認して記録する。
- APIキーの非露出（クライアント、localStorage、会話履歴へ出ないこと）は`llmSecretStore`、`llmSecretApi`、`llmRuntime`の既存テストで確認する。移動に伴ってこれらのテストを弱めない。
- 以下を作業後に確認し、結果を作業記録に残す。
  - `@ai-sdk/`のimportが`src/features/llm/`以外（テスト、`src/evals/`を除く）にない。
  - `src/features/llm/`から`ai-agent`、`ai-chat`、`ai-assist`、`siwc`への参照がない。
  - `src/features/ai-tools/`が残っていない。
- サーバー専用モジュールがクライアントへ混入していないことを`bun run build`の成功で確認する。
- `docs/architecture.md`、`specs/`、`AGENTS.md`、`agent-field-guide/`のパス参照を検索し、移動先へ更新する。

## 完了条件

- [x] LLM接続・APIキー・LLMプロファイル・モデル選択が`src/features/llm/`へ移り、`ai-agent`はエージェント実行・ツール・文脈・執筆委譲だけになった。
- [x] `ai-tools`を`ai-agent`へ吸収した。
- [x] `llm`と`siwc`の間に循環がない。
- [x] ドキュメントのパス参照と依存の向きを更新した。237が完了済みなら許可表も更新した。
- [x] `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e`、`bun run test:desktop`が成功した。
- [x] doneへ移動してcommitした。


## 作業記録

- LLM接続と設定を`llm/`へ、SIWCアダプタを`siwc/`へ移動。`ai-agent`は`tools/`・`context/`・`writing/`に整理し、`ai-tools`を削除した。隣接テストは同じ場所へ移し、検証内容を維持した。
- SIWC serviceの型依存を`ConnectedModelInventory`へ置き換え、composition rootから実体を注入する。OpenAI SDK生成は`llm/providers/openaiResponses.ts`へ委譲し、HTTP/SSE検証はSIWC側に保持した。API経路・応答形・認証・保存形式は変更していない。
- 新規の振る舞いテストは追加しない。挙動不変の移動として既存の回帰テストを使い、APIキー非露出・アカウント境界・SDK契約の既存保証を維持した。文書のパス参照テストとVitestのDOM分類のパスを更新した。
- 62件の移動ファイルを旧内容と比較し、module参照以外の差分はinventory型の切り離しとSDK生成の委譲だけであることを確認した。レビューで検出したパス判定文字列の誤置換は修正し、最終検証を再実行した。
- 境界検索: `@ai-sdk/*`のimportは`llm/`のみ（テスト・evalを除く）。`llm`から`ai-agent`・`ai-chat`・`ai-assist`・`siwc`へのimportなし。`ai-agent`から`llm/secrets`への参照なし。`ai-tools/`なし。
- README、architecture、モデルカタログ更新手順、現行SIWC仕様、Field Guideのパス参照を更新した。製品の挙動仕様変更はない。237は未完了のため許可表更新は対象外。
- 手動レビュー: 移動差分、秘密情報の境界、文書整合、`git diff --check`は問題なし。モジュール移動の一括置換で得た知見はField Guideに記録した。

### 検証結果

- `bun run typecheck`: 成功。
- `bun run test`: 147ファイル、1211件成功。既存の1ファイル・6件はskip。
- `bun run build`: 成功。移動後もクライアントとサーバーのbuild・prerenderが成立。
- `bun run test:e2e`: Chromium 29件成功（最終状態で再実行）。
- `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk bun run test:desktop`: 成功。Web build、Rust 14件・sidecar smoke、Vitest 12ファイル75件成功。既存Field GuideのTAPI不整合の知見に従い、SDK選択はコマンド単位とした。
- 初回の全体テスト・build・E2Eはサンドボックスのlisten拒否で失敗した。制限外実行の承認後に再実行して成功した。
- 未実行: Windows実機・配布アプリの確認、実LLM/live smoke。OS・外部API・SDK契約を変更しない内部整理のため今回の対象外。SIWC HTTP/SSEは既存の偽HTTP契約テストで確認し、実認証・応答品質の確認とは扱わない。
