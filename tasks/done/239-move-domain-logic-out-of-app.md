# 239 `src/app/`からドメインロジックを各featureへ移す

## 目的

`src/app/`の責務を、アプリシェル、共通レイアウト、画面間で共有するContextの組み立てに限定する。LLM設定とワークスペース復元のロジックを担当featureへ移し、ルートの解決経路を単純にする。製品の挙動は変えない。

## 難易度

- 判定: 中
- 理由: 対象は`App.tsx`（367行）と関連する数ファイルに限られるが、ワークスペース復元、初回モーダル、開始ガイド、LLM設定の読み込みはReactの状態とeffectの順序に依存する。移動で復元の競合判定やeffectの実行順が変わると気づきにくい回帰になる。`App.test.tsx`の既存の結合テストが主な安全網になる。

## 前提

- `238-split-llm-feature-from-ai-agent.md`が完了していること（LLM関連の移動先を`src/features/llm/`とするため）。

## 現状の問題

1. **LLM設定のロジックが`app/`にある。**
   - `useLlmSettings.ts`: provider一覧、LLMプロファイル、APIキー状態のAPI取得とlocalStorage書き込み、SIWC接続設定の初期化。
   - `LlmSettingsContext.tsx`: 上記の共有。
   - `llmMainRoleAssignment.ts`: メインロールのプロファイル・モデル選択の更新と、チャット画面へ渡すpropsの組み立て。
   - `llmDisplay.ts`: provider選択肢から表示用プロファイル一覧を作る変換。
2. **ワークスペースの復元・選択のロジックが`App.tsx`にある。**
   - 保存済みワークスペースの`/api/workspace/validate`による検証と復元、復元中の競合判定（`readStoredWorkspaceRoot() !== previousWorkspaceRoot`）、失敗時の削除、開始ガイドの表示判定が`App`コンポーネント内のeffectとして書かれている。
   - `workspaceSessionStorage.ts`のうち、ワークスペースルートの保存・読み出しはワークスペースの関心事で、最後の作業モード（`WorkMode`）とルート解決はアプリシェルの関心事。
3. **ルートページが`App.tsx`の再exportを経由している。**
   - `src/routes/*.tsx`が`../app/App`から`ChatRoutePage`などを取り出しており、`App.tsx`が「共有状態」と「ページの公開窓口」を兼ねている。

## 対象範囲

- LLM設定（上記1）を`src/features/llm/`へ移す。`useLlmSettings`と`LlmSettingsContext`は`llm`の公開hook・Providerとし、`llmMainRoleAssignment`のうちチャット画面のprops組み立てに当たる部分は`ai-chat`側に置くかを実装開始時に判断する。
- ワークスペースの復元・選択（上記2）を`src/features/workspace/`のhook（例: `useWorkspaceSession`）へ移す。`App.tsx`はそのhookの戻り値を`WorkspaceContext`へ渡すだけにする。`workspaceSessionStorage.ts`はワークスペースルート部分を`workspace`へ、作業モード部分を`app/`に残す形で分ける。
- ルートページ（上記3）は`src/routes/*.tsx`から各`*RoutePage.tsx`を直接importし、`App.tsx`末尾の再exportを削除する。
- 移動後の`src/app/`の責務を`docs/architecture.md`の「全体構成」に反映する。

## 対象外

- `EditorRoutePage.tsx`（308行）のAIアシスト配線の整理。画面の組み立てとして`app/`に残し、必要なら別タスクにする。
- `threePaneLayout.ts`、`PaneLayoutContext.tsx`、`AppShell.tsx`（レイアウトはアプリシェルの責務として残す）。
- Contextの分割方法や状態管理ライブラリの導入など、状態設計そのものの変更。
- localStorageのキー、保存形式、APIの経路の変更。

## 検証方針

- 挙動を変えない内部整理のため、原則として新規の振る舞いテストは追加しない。`src/app/App.test.tsx`の既存テスト（作業モードのルート解決、初回モーダル、テンプレート作成後の開始ガイド、復元失敗時の回復モーダル、検証成功後だけの復元、旧キーの互換、検証失敗時の削除）を回帰検出の主な手段とする。
- 移動したロジックのテスト（`llmMainRoleAssignment.test.ts`、`workspaceSessionStorage.test.ts`）は移動先へ一緒に移し、検証内容は変えない。
- 作業前に`App.test.tsx`の復元に関するテストが、復元の競合判定（復元中に保存済みルートが変わった場合に古い結果を適用しない）を検証しているか確認する。検証していなければ、移動前にその振る舞いを固定するテストを追加し、成功することを確認してから移動する。
- 作業後に以下を確認し、結果を作業記録に残す。
  - `src/app/`に`apiFetch`の呼び出しが残っていない。
  - `src/routes/`から`../app/App`への参照がルートの`__root.tsx`だけになっている。
- 画面の挙動は`bun run test:e2e`で確認する。

## 完了条件

- [x] LLM設定のロジックが`src/features/llm/`へ、ワークスペース復元のロジックが`src/features/workspace/`へ移った。
- [x] `src/app/`がシェル、レイアウト、共有Contextの組み立て、ルートページだけになった。
- [x] `src/routes/`が各ルートページを直接参照している。
- [x] `docs/architecture.md`を更新した。
- [x] `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e`が成功した。
- [x] doneへ移動してcommitした。

## 作業記録

- 実装開始時に難易度「中」を再確認。対象と回帰リスクは当初の評価どおりで、製品仕様との矛盾なし。
- 移動前にAppの復元競合テストを追加。検証待機中に別のワークスペースを選択した場合、古い検証の成功（200）・失敗（400）のいずれでも新しい選択と保存値を保持する。既存テストと合わせて46件成功してから実装へ進んだ。
- 挙動不変の内部整理のため、競合ケース以外の新規テストは追加しない。既存のApp結合テスト、LLM選択テスト、保存互換テストを継続し、分割した責務に合わせて隣接配置した。
- LLM設定hook・Context・表示変換・メインロール更新を`features/llm`へ移動。チャット向けprops組み立てを`features/ai-chat/mainLlmChatPaneProps.ts`へ分離。
- SIWC移行意図の初期化呼び出しは、LLMの自動保存より前にAppのcompositionで実行。LLM featureからSIWCへの逆依存を作らず、初期レンダー時の判定を維持した。
- `useWorkspaceSession`へ復元、選択、開始ガイドを抽出。ルート保存と旧キー互換はworkspaceへ、作業モード保存と起動ルート解決はappへ分割。API経路・保存キー・保存形式は維持した。
- ルートページを直接importし、Appの再exportを削除。`src/app/`に`apiFetch`呼び出しがなく、`src/routes/`の`../app/App`参照が`__root.tsx`だけであることを検索確認。
- `docs/architecture.md`に各featureとappの責務を反映し、差分レビューで製品仕様との整合と対象外変更がないことを確認。
- ルートの直接参照で既存のhydration完了通知の早すぎるタイミングが表面化。Playwright全体は24件成功・5件失敗し、1 workerでも再現した。変更前コミットを一時フォルダで同条件検証すると対象5件は成功した。
- `hydrateRoot`直後の完了通知をAppのmount effectへ移動。既存E2Eの失敗5件を回帰検出に使い、修正後は5件すべて成功。画面操作やAPI契約を変えず、検証用の準備通知を実際のmountに合わせた。新規の重複テストは追加していない。

## 最終検証

- `bun run typecheck`: 成功。
- `bun run test`: 149ファイル成功、1ファイルskip。1,213件成功、6件skip。
- `bun run build`: client/serverビルドとprerender成功。
- `bun run test:e2e`: 通常の5 workersで全29件成功（22.8秒）。APIモックによる画面連携に加え、実ファイル保存・再取得、実履歴経由のApply/Undo、合成OAuth/LLMによるSIWCのHTTP経路を確認。
- `git diff --check`: 成功。App内のAPI呼び出し、ルートからのApp参照、移動先の責務と旧保存キー互換を差分・検索で確認。
- 初回のtest/build実行ではsandboxによるloopback待ち受け拒否（EPERM）が発生。実行権限を調整した再実行で成功。
- `bun run test:desktop`、配布アプリ実機、実LLM呼び出しは未実行。desktop起動・通信・ネイティブ境界およびLLM要求契約は変更していないため、今回の内部整理の検証対象外。ブラウザの表示と操作はPlaywrightで確認し、別途手動確認は行っていない。
