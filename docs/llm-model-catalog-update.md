# LLMモデルカタログ更新手順

OpenAI、Anthropic、Gemini、DeepSeekが新しいAPIモデルを公開したときに、Ghostwriterで選択・実行できるモデル候補を更新する手順です。上から順に実行し、各チェック欄を埋めてください。

## 0. この手順の対象

対象はVercel AI SDK経由で使う次の固定カタログです。

| Provider ID | 公式API | AI SDK package | モデル定義 |
|---|---|---|---|
| `openai` | OpenAI API | `@ai-sdk/openai` | `src/features/llm/providers/openai.ts` |
| `anthropic` | Claude API | `@ai-sdk/anthropic` | `src/features/llm/providers/anthropic.ts` |
| `gemini` | Gemini API | `@ai-sdk/google` | `src/features/llm/providers/gemini.ts` |
| `deepseek` | DeepSeek API | `@ai-sdk/deepseek` | `src/features/llm/providers/deepseek.ts` |

次は対象外です。

- ChatGPTプラン: 認証済みの動的inventoryを使うため、固定カタログへ追加しない。
- `openai-compatible`: 接続先のモデル一覧またはユーザー入力を使うため、4社の新モデルを固定追加しない。
- providerの新規追加、APIキー保存方式の変更、自動fallbackの追加。

## 1. タスクを作る

- [ ] `tasks/open/`と`tasks/done/`を確認し、未使用の次番号でタスクを作る。
- [ ] タスクに`## 難易度`、API事前確認、対象範囲、対象外、テスト、完了条件を書く。
- [ ] `specs/novel-editor-mvp.md`、`specs/development-workflow.md`、作成したタスクを読む。
- [ ] 調査後に範囲が変わった場合、実装前に難易度を更新する。

タスク名の例: `NNN-support-<provider>-<model-family>.md`

複数providerを同時更新すると調査漏れが増えるため、同時発表や共通SDK更新でない限り1 providerずつ扱います。

## 2. API preflightを記録する

モデル名の発表記事だけで実装を始めてはいけません。タスク本文の`## API事前確認`に次を記録します。

### 2.1 情報源を固定する

優先順位は、利用可能なら「実APIの最小レスポンス > 公式APIリファレンスまたはOpenAPI > 公式モデル一覧・廃止予定 > インストール済みAI SDKの型・実装」です。ブログ、SNS、ChatGPTなどの記憶だけを根拠にしません。

| Provider | 最初に確認する公式ページ |
|---|---|
| OpenAI | `https://developers.openai.com/api/docs/models` |
| Anthropic | `https://platform.claude.com/docs/en/about-claude/models/overview` と `model-deprecations` |
| Gemini | `https://ai.google.dev/gemini-api/docs/models` と deprecations |
| DeepSeek | `https://api-docs.deepseek.com/quick_start/pricing`、modelsまたは更新履歴 |

ページURLが移動していたら公式サイト内で探し、タスクには実際に確認したURL、確認日、モデルのavailability（GA/preview/招待制）を残します。

### 2.2 採用候補表を埋める

| 項目 | 必須の記録 |
|---|---|
| API model ID | SDKへ渡す完全一致の文字列。製品表示名やChatGPT/Codex名を流用しない |
| availability | GA、preview、招待制、地域・tier制限 |
| lifecycle | active、deprecated、retirement日、後継ID |
| context window | 入力上限。根拠がなければ未定義にして推測値を入れない |
| max output | 既定プロフィールの`maxOutputTokens`を満たすか |
| tools | function/tool callingの可否と制限 |
| streaming/usage | Vercel AI SDKで現在の実行経路を使えるか |
| sampling | `temperature`、`top_p`、`top_k`などの受付可否 |
| endpoint | SDKが使うendpointと必須body/header |
| errors | unsupported model、認証、rate limitのstatus/body。別providerへfallbackしない |

provider全体に適用されるparameter廃止（例: 特定世代以降でsampling parameterが400になる）を見つけた場合は、新モデルだけでなく登録済みモデルが同じ条件に該当しないかを確認し、該当するものはこのタスクで是正します。

エンドポイント契約には最低限、認証header、`model`、messages/input、最大出力指定、tool指定、stream指定のrequired/optional、型、nullable、default、条件付き必須を記録します。不明点は`any`や型キャストで隠さず、公式情報または機密を残さない最小APIリクエストで解消します。

### 2.3 Go/No-Goを判定する

次をすべて満たした場合だけ`Go`です。

- [ ] 正式なAPI model IDが確定している。
- [ ] 現在のAI SDKまたは安全なSDK更新でモデルを生成できる。
- [ ] tool callingを使うロールへ割り当て可能か判断できる。
- [ ] sampling制約と最大出力制約が確定している。
- [ ] preview/制限付きモデルを通常の既定値にするか明示的に判断した。
- [ ] 廃止モデルを残すか削除するか決めた。
- [ ] 未確定事項、競合する情報、実API未検証事項が記録されている。

No-Goなら実装せず、blockerと次の確認方法をタスクへ残します。

## 3. 変更範囲を決める

通常は次のファイルだけを変更します。

| 目的 | ファイル |
|---|---|
| providerの許可済みモデル | `src/features/llm/providers/<provider>.ts` |
| `main`/`writing`/`simple`/`search`の既定値 | `src/features/llm/profiles/llmProfiles.ts` |
| providerとプロフィールの契約テスト | `src/features/llm/modelProvider.test.ts`、`src/features/llm/profiles/llmProfiles.test.ts` |
| APIレスポンスとsecret非露出 | `src/features/llm/modelProviderApi.test.ts` |
| provider生成・sampling制約 | 対象provider近傍のテスト、`src/features/llm/llmRuntime.test.ts`、`src/features/ai-agent/runAgentLoop.test.ts` |
| 製品仕様のモデル一覧・プリセット | `specs/novel-editor-mvp.md` |
| 利用者向け一覧 | `README.md` |
| SDK version | `package.json`、`bun.lock` |

`runAgentLoop`へprovider名による分岐を追加しません。固有処理はprovider pluginのモデルメタデータまたは`ModelProvider`境界に閉じ込めます。

## 4. 先に失敗するテストを書く

実装前に既存の近いテストをコピーして、少なくとも次を期待値に追加します。

- [ ] 新モデルの`id`、`displayName`、`supportsTools`、既知なら`contextWindowTokens`。
- [ ] 非対応の場合は`supportsTemperature: false`。
- [ ] `/api/llm/providers`に新モデルが出て、APIキー本文・base URLなどのsecretが出ない。
- [ ] 新モデルIDがserver allowlistを通り、未知IDは拒否される。
- [ ] 内蔵プロフィールを変更する場合、4ロールすべての期待値。
- [ ] sampling非対応モデルでは実行時に`temperature`を送らない。
- [ ] 保存済みの非廃止モデルが引き続き利用できる、または廃止モデルの安全なfallbackが働く。

対象テストを実行し、新しい期待値によって失敗することを確認します。テストを先に書けない場合は、理由と代替検証をタスクへ記録します。

```sh
bun run test src/features/llm/modelProvider.test.ts src/features/llm/modelProviderApi.test.ts src/features/llm/profiles/llmProfiles.test.ts
```

## 5. 実装する

1. 対象providerの`models`へモデルを追加する。
2. `id`は公式API IDを完全一致で入れる。
3. `displayName`はUI向けの短い正式名称にする。
4. `supportsTools`は確認できた場合だけ`true`にする。
5. `contextWindowTokens`は一次情報で確認できた場合だけ設定する。不明なら省略し、既存の`200000`表示用fallbackを使う。
6. sampling非対応なら既存の`supportsTemperature: false`経路を使う。新しい種類の制約はテストで固定してからplugin境界へ追加する。
7. 既定に採用する場合だけ`builtInLlmProfiles`の該当ロールを変更する。高品質、低コスト、tool対応、出力上限をロールごとに判断し、全ロールを機械的に同じモデルへ変えない。
8. activeな旧モデルは保存済みプロフィール互換のため原則残す。deprecated/retiredを削除する場合は、保存値の利用不可表示または既存fallbackをテストする。

SDKが新モデルを扱えない場合だけ依存を更新します。4 providerを無関係に一括更新しません。

```sh
bun add @ai-sdk/<対象package>@<確認したversion>
```

lockfileはコマンドで更新し、手編集しません。SDK更新後は型変更、endpoint変更、provider生成API（例: DeepSeekの`.chat(modelId)`）を確認します。

## 6. 文書を同期する

- [ ] `specs/novel-editor-mvp.md`のproviderモデル一覧を実装と一致させる。
- [ ] 内蔵プロフィールを変えたら同仕様の4ロールも更新する。
- [ ] 新しいsampling制約、preview条件、fallback方針を仕様へ書く。
- [ ] `README.md`の利用可能model ID一覧を一致させる。
- [ ] タスクに公式URL、確認日、採用・非採用理由、実API疎通の有無を残す。
- [ ] 実APIキー、request本文、response本文、ユーザーデータを文書・fixture・ログへ残さない。

## 7. 検証する

```sh
bun run typecheck
bun run test
```

必要に応じて`bun run test:e2e`も実行します。認証情報が利用できる場合だけ、各providerへ機密を記録しない最小疎通を行い、次をタスクへ結果だけ記録します。

- model IDが受理された。
- streamingが完了した。
- tool callingが必要なモデルではtool呼び出しが成立した。
- usageが既存の集計境界で読めた。
- sampling制約違反がない。

実API疎通をしなかったことは失敗ではありません。「未実施」と理由を明記し、モックテストで保証した範囲を分けます。

## 8. レビューと完了

- [ ] `git diff --check`が成功する。
- [ ] `git diff`に対象外変更やsecretがない。
- [ ] provider実装、仕様、README、テストのmodel IDを相互照合する。
- [ ] 公式上存在しない推測モデル、ChatGPT専用名、Codex専用名が混ざっていない。
- [ ] 完了条件とテスト結果をタスクへ記録する。
- [ ] タスクを`tasks/open/`から`tasks/done/`へ移動する。
- [ ] 関連変更だけをcommitする。

コミット例: `feat(llm): support <provider> <model>`

## 軽量LLM向け停止条件

次のどれかに当たったら推測で進めず、上位モデルまたは人へ確認してください。

- 公式モデル一覧、APIリファレンス、SDK型のmodel IDが一致しない。
- endpoint、認証、必須parameter、error schemaのどれかが不明。
- provider plugin境界だけではsamplingやtool制約を表現できない。
- 廃止モデルの削除が保存済みプロフィールを壊す可能性がある。
- SDK major更新や`ai` packageとのpeer dependency変更が必要。
- secret、課金、rate limit、地域制限を含む実API検証が必要。
