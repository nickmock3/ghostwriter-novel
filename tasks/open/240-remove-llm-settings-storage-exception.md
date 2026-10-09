# 240 `llm`・`ai-chat`から`settings/settingsStorage`への逆依存を解消する

## 目的

237で許可表の例外として残した`llm`・`ai-chat`→`settings/settingsStorage.ts`の参照をなくし、feature間の依存を例外なしの一方向にする。製品の挙動とユーザー設定の保存形式は変えない。

## 難易度

- 判定: 中
- 理由: 対象は`llm`の数ファイル、`ai-chat`の1ファイル、`src/app/`のContextに限られる。ただし`LlmSettingsContext`がユーザー設定全体の共有も兼ねており、設定画面・チャット・エディットの各画面が依存している。provider読み込み後に未選択モデルを補完する処理のタイミングが変わると、モデル選択が消える・既定に戻るといった気づきにくい回帰になる。

## 背景

`UserSettings`（`settings/settingsStorage.ts`）は、複数featureの設定（`llm`のモデル選択、`ai-chat`の自動圧縮、`workspace`の復元、`editor`・`file-tree`の表示）を1つの設定画面とlocalStorageの1キーへ束ねたもの。束ねる側は上位にいるのが自然なので、`settings`を最上位とする現在の配置は維持する。`settingsStorage`を`src/shared/`など下位へ移す案は、`shared`が`llm`の`SelectedModel`などfeatureの型を抱えることになるため採らない。

調査時点で、`llm`・`ai-chat`が`UserSettings`から実際に必要としているのはモデル選択だけだった。

| ファイル | 現在の参照 |
| --- | --- |
| `llm/llmMainRoleAssignment.ts`、`ai-chat/mainLlmChatPaneProps.ts` | `UserSettings["modelSelection"]`（実体は`llm`の`SelectedModel \| null`） |
| `llm/useLlmSettings.ts` | `settings`・`setSettings`を受け取り、provider読み込み後に`normalizeUserSettings(current, providers)`でユーザー設定全体を正規化（意味があるのは未選択モデルの補完） |
| `llm/LlmSettingsContext.tsx` | `settings`・`setSettings`をユーザー設定全体の共有として保持。`SettingsRoutePage`（設定画面全体）、`ChatSessionContext`（`autoCompactEnabled`など）、`EditorRoutePage`が参照 |

## 対象範囲

1. `llm/llmMainRoleAssignment.ts`、`ai-chat/mainLlmChatPaneProps.ts`の型参照を`SelectedModel | null`へ置き換える。
2. `useLlmSettings`は`UserSettings`を受け取らず、モデル選択の値と更新関数だけを受け取る（例: `modelSelection`、`onModelSelectionChange`）。provider読み込み後の未選択モデル補完は、`llm/selection`の関数（例: `resolveModelSelection(selection, providers)`）として`llm`側に置く。`settingsStorage.ts`の`normalizeUserSettings`もその関数を使う。
3. ユーザー設定全体の状態と共有を`LlmSettingsContext`から分離する。`src/app/`にユーザー設定用のContext（例: `UserSettingsContext.tsx`）を置き、`App.tsx`でユーザー設定とモデル選択を結線する。`LlmSettingsContext`はLLMのprovider・プロファイル・APIキー状態だけを持つ。
4. `src/features/featureDependencies.test.ts`のmodule単位の例外（`allowedModules`）を削除する。例外の仕組み自体が不要になれば検査コードからも取り除く。
5. `docs/architecture.md`の「feature間の依存方向」から、`settings/settingsStorage.ts`の例外の記述を削除する。

## 対象外

- localStorageのキー（`ghostwriter:user-settings:v1`、旧キー）、保存JSONの形、旧キーからの読み込み互換の変更。
- 設定項目を各featureの別キーへ分割すること。
- `settings`画面の構成変更。

## 検証方針

- 挙動を変えない内部整理のため、新規の振る舞いテストは原則追加しない。
- 先行する検証として、作業前に`App.test.tsx`、`settingsStorage.test.ts`、`llmSelection.test.ts`、`llmMainRoleAssignment.test.ts`が次の振る舞いを検証しているか確認する。検証していなければ、移動前にその振る舞いを固定するテストを追加し、成功することを確認してから変更する。
  - provider読み込み後、モデル未選択なら使える最初のモデルが補完される。
  - 保存済みのモデル選択は、provider読み込み後も上書きされない。
  - providerの読み込みに失敗しても、他のユーザー設定（自動圧縮、表示設定など）は変わらない。
- 未選択モデル補完の関数を`llm/selection`へ移した場合は、補完の分岐を`llmSelection.test.ts`で検証する。`settingsStorage.test.ts`の既存テストは保存形式と互換の確認として残す。
- `featureDependencies.test.ts`から例外を削除した状態で成功することを確認する。あわせて、一時的に`llm`から`settings/settingsStorage`へのimportを戻すと検査が失敗することを確認し、そのimportを戻す。この確認は作業記録に残す。

## 完了条件

- [ ] `src/features/`の本番コードに`settings/settingsStorage`への参照が`settings`以外から残っていない。
- [ ] `featureDependencies.test.ts`と`docs/architecture.md`から`settingsStorage`の例外を削除した。
- [ ] ユーザー設定の保存形式・キーを変えていない。
- [ ] `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:e2e`が成功した。
- [ ] doneへ移動してcommitした。
