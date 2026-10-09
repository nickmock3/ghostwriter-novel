# 236 feature間の循環依存・逆向き依存の解消

## 目的

`src/features/`配下で、下位featureが上位featureを参照している依存と循環依存を解消し、依存の向きを`docs/architecture.md`へ明文化する。製品の挙動は変えない。

## 難易度

- 判定: 中
- 理由: 変更はimport先と定義の移動が中心で挙動は変えないが、`settingsStorage`の型を参照する約20ファイル、ripgrepツールとAIエージェントのツール定義、データ保存先の解決にまたがる。移動先の境界判断が必要で、サーバー専用モジュールがクライアントのバンドルへ混入する回帰にも注意が要る。

## 前提

目標とする依存の向き（左が下位）:

```text
shared → workspace → edit-proposals → ai-tools → ai-agent → ai-chat / ai-assist
                                                  ↑
                                          siwc（LLM接続の実装）
settings（画面）は各featureのUIセクションを組み立てる上位とする
editor / file-tree / reader は workspace と edit-proposals に依存してよい
```

同階層の`ai-chat`と`ai-assist`は互いに依存しない。共有が必要なものは下位へ移す。テストファイル（`*.test.ts(x)`）からの横断importは結合テストのため対象外とする。

## 対象（調査時点の逆向き・循環依存）

1. **`workspace` / `ai-assist` → `ai-chat`（データ保存先）**
   - `defaultConversationDataRoot()`（`ai-chat/conversationHistory.ts`）を`workspaceTemplateStore.ts`、`workspaceTemplateApi.ts`、`aiAssistStore.ts`、`aiAssistApi.ts`が参照している。
   - 実体は`resolveServerDataRoot`の呼び出しだけなので、`src/shared/server/applicationStorage.ts`など`shared/server`側へ`defaultServerDataRoot()`として移し、各所から参照する。`ai-chat`側の関数は削除するか移動先の再exportにとどめず、呼び出し側を移動先へ直接向ける。

2. **`ai-agent` → `ai-chat`（プランのスキーマ）**
   - `ai-agent/agentTools.ts`が`planItemSchema`と`PlanItem`を`ai-chat/conversationSchemas.ts`から取っている。
   - `UpdatePlan`ツールの契約なので、`ai-agent`側（例: `ai-agent/agentPlan.ts`）へ定義を移す。`ai-chat`の会話スキーマはそれを参照する。

3. **`workspace` ⇄ `ai-tools`（循環）**
   - `workspace/workspaceSearchStore.ts`が`ai-tools/ripgrepTools.ts`の入出力型を参照し、`ripgrepTools.ts`は`localWorkspaceSearchStore`を参照している。
   - 検索ストアの入出力型（`GlobToolInput`/`Output`などに相当するもの）を`workspace`側で定義し、`ripgrepTools.ts`のZod schemaはその型に`satisfies`などで適合させる。ツールとしての返却形と件数制限（最大10件）は変えない。

4. **`ai-assist` → `ai-chat`（モデル選択）**
   - `LlmProfileWithAvailability`、`chatModelSelection.ts`の関数、`ChatModelSelector`/`ChatModelUnavailableReasons`をAIアシストが流用している。
   - チャット固有でない選択ロジックと選択UIは`ai-agent`側（LLMプロファイルの所在に合わせる）へ移し、`ai-chat`と`ai-assist`の両方から参照する。チャット専用の判定が混ざっている場合は分けて残す。

5. **`settings` ⇄ `siwc`、および各featureから`settings`へのLLM型依存**
   - `settings/settingsStorage.ts`に、UI設定とは別のLLM選択の型（`SelectedModel`、`LlmModelChoice`、`LlmProviderChoice`、`llmProviderListResponseSchema`、`LlmSecret*`系）が同居している。`siwc/useAiConnection.ts`、`ai-agent/llmProfileStorage.ts`、`ai-agent/LlmProfilesPage.tsx`がこれを参照し、一方で`settings/SettingsPage.tsx`は`siwc`のUIを取り込むため循環になっている。
   - LLM選択の型とschemaを`ai-agent`側（例: `ai-agent/llmSelection.ts`）へ移す。`settingsStorage.ts`にはlocalStorageのキー、`UserSettings`、既定値、読み書きだけを残す。
   - localStorageのキーと保存JSONの形は変えない（既存ユーザー設定の互換維持）。

6. **`editor` → `ai-assist`（型）**
   - `editor/EditorPane.tsx`が`AiAssistEditorTarget`を`ai-assist/AiAssistPane.tsx`から取っている。
   - エディターが公開する選択範囲・本文の型として`editor`側で定義し、`ai-assist`がそれを参照する向きに変える。

## 対象外

- `ai-agent`のディレクトリ分割（`llm`featureの新設）や`ai-chat`のサブディレクトリ化。本タスクでは移動先を既存featureにとどめる。
- 依存ルールの自動検査の導入は`237-enforce-feature-dependency-rules.md`で扱う。
- `src/app/`配下のLLM関連ロジックの移動。

## 検証方針

- 挙動を変えない内部整理のため、新規の振る舞いテストは追加しない。既存のVitest、型チェック、Playwrightで回帰を検出する。
- 先行する検証として、作業前に下記のimport調査コマンドで対象の逆向き依存を列挙し、作業後に0件（テストファイルを除く）になることを確認する。

  ```bash
  grep -rnE "from ['\"]\.\./(ai-chat|ai-assist|ai-tools|settings)/" src/features/workspace src/features/ai-agent src/features/ai-tools src/features/siwc src/features/editor src/features/ai-assist | grep -v "\.test\."
  ```

  `ai-assist`→`settings`のうち、UI設定（`UserSettings`）の参照は許容する。残った行は理由を作業記録に書く。
- 移動した定義のテストは、定義と一緒に移動先へ移す。テストの検証内容は変えない。
- localStorageのキーと保存形式が変わっていないことを`settingsStorage.test.ts`の既存テストで確認する。
- サーバー専用モジュール（`node:`のimportを含むもの）をクライアント側から新たに参照していないことを`bun run build`の成功で確認する。

## 完了条件

- [x] 対象1〜6の逆向き・循環依存を解消した（テストファイルを除く）。
- [x] `docs/architecture.md`に依存の向きを追記した。
- [x] `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e`が成功した。`bun run test:desktop`は`shared/server`を変更した場合に実行する。
- [x] 作業範囲外の挙動変更がない。doneへ移動してcommitした。

## 作業記録

- 開始時に難易度「中」が対象範囲に合うことと、製品仕様に矛盾がないことを確認した。
- 共通の保存先解決を`shared/server/applicationStorage.ts`、プラン項目を`ai-agent/agentPlan.ts`、検索契約を`workspaceSearchStore.ts`へ移した。
- LLM契約を`ai-agent/llmSelection.ts`、共通の選択ロジック・UIを`llmModelSelection.ts`と`LlmModelSelector.tsx`へ移し、呼び出し側を直接参照へ変更した。
- 本文・選択範囲の型は`editor/editorTarget.ts`の`EditorTarget`として公開した。
- 既存のUIテストとLLM secret provider判定テストは定義と一緒に移動した。新しい振る舞いテストは追加していない。挙動不変の整理のため、既存テスト・型チェック・buildで契約と回帰を検証した。
- 対象の逆向きimportはテストを除いて0件。タスクの広い検索パターンに残る`ai-agent/agentTools.ts`→`ai-tools/ripgrepTools.ts`は、前提で許可した上位から下位への依存であり、除去対象ではない。`ai-assist`→`settings`のUI設定参照も残っていない。
- `docs/architecture.md`へ依存方向と共通定義の所在を追記した。製品仕様・localStorageのキーとJSON・検索上限・保存先解決順は変更していない。

### 検証結果

- `bun run typecheck`: 成功。
- `bun run test`: 147ファイル、1211件成功、既存6件skip。sandboxでの初回はlisten制限、sandbox外の初回はstream cancellationケースのfixture削除が`ENOTEMPTY`となった。全体再実行は成功した。
- `bun run build`: 成功。クライアントへのサーバー専用module混入は発生していない。初回のsandbox内実行はViteのlisten制限で中断したため、sandbox外で検証した。
- `bun run test:e2e`: 29件成功。初回のsandbox内実行はlisten制限。sandbox外の初回は検証中のソース整形後にcontext例外が出たため、編集を止めて全体を再実行し成功した。実ファイルの保存・Apply/Undoを含む。外部OAuth/LLMは既存fixtureによる置換。
- `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk bun run test:desktop`: 成功（sidecar smoke、Rust、Vitest 12ファイル75件）。既定27.0 SDKでは既存linkerとのTAPI不整合で失敗したため、既存Field Guideに従いコマンド単位で26.5 SDKを選択した。グローバル設定は変更していない。
- `git diff --check`、差分レビュー、対象import調査: 成功。手動の画面操作は行っていない。画面回帰は既存Playwrightで確認した。
- 必須検証に未実行項目はない。実LLMの品質やWindows実機は接続契約・製品挙動を変えていないため対象外。
