# OpenAI・Anthropic・Geminiのモデル候補を更新する

## 難易度

- 判定: 中
- 理由: 3社のモデル契約と固定カタログを更新し、既存SDKが会話とツール実行に必要なリクエストを生成するか確認する。AI SDK本体と4つのプロバイダーの互換更新も含める。変更はLLM境界に収まる。

## 対象範囲

固定カタログ、内蔵プロフィール、README、製品仕様、AI SDK本体と全プロバイダーパッケージ。ChatGPTプランの動的モデル一覧、OpenAI互換接続とDeepSeekのカタログ、ユーザー定義プロフィールの保存値は対象外。

## API事前確認

2026-11-18確認。以下はいずれもテキスト出力、ストリーミング、アプリの関数ツールに対応する。認証、リクエスト組み立て、ストリームとエラーの解釈には既存のAI SDKと接続設定を使う。

| APIモデルID | 提供状況 | コンテキスト / 最大出力 | 採用 |
| --- | --- | --- | --- |
| `gpt-6.2-astra`, `gpt-6.2-sol` | OpenAI APIで提供中、利用枠はアカウント依存 | 1,050,000 / 128,000 | Astraを執筆、Solを通常に採用。Responses APIでツールを実行 |
| `gpt-6.1-sol`, `gpt-6.1-terra` | OpenAI APIで提供中、利用枠はアカウント依存 | 1,050,000 / 128,000 | 選択肢に追加。軽作業・検索には低コストのGPT-6 Lunaを使用 |
| `claude-fable-5-2` | Claude APIで一般提供、通常は30日間のデータ保持が必要 | 1,000,000 / 128,000 | 執筆用。ツール選択は自動。2027-11-09より前の退役予定なし |
| `claude-sonnet-5-5` | Claude APIで一般提供 | 1,000,000 / 128,000 | 選択肢に追加。ツール選択は自動。2027-09-28より前の退役予定なし |
| `claude-haiku-5-5` | Claude APIで一般提供 | 1,000,000 / 128,000 | 軽作業・検索用。2027-10-07より前の退役予定なし |
| `gemini-4-hydrogen` | GA、無料枠・有料枠 | 1,048,576 / 65,536（通常ストリーム） | 通常・執筆用。軽作業・検索はFlash-Liteを使用 |
| `gemini-4-carbon`, `gemini-4-argon` | GA、有料枠 | 1,048,576 / 65,536（通常ストリーム） | 選択肢に追加。Gemini 4は終了日未発表 |

- [OpenAI のモデル一覧](https://developers.openai.com/api/docs/models)、[GPT-6.2移行ガイド](https://developers.openai.com/api/docs/guides/latest-model)。Bearer認証の `POST /v1/responses` に `model` 文字列、会話の `input`、ストリーム時は `stream: true`、設定時は `max_output_tokens` と関数 `tools` を送る。省略可能項目にnullを送らない。GPT-6.2は推論を無効にできず、sampling項目を省略する。既存の推論要約設定を利用する。SDK 4.0.121はGPT-6.xを推論モデルとして認識する。認証・アクセス・未知ID・レート制限はAPIの `error` オブジェクトを既存のSDK経路で扱う（401/403、404、429）。
- [Claude のモデル一覧](https://platform.claude.com/docs/en/models/overview)、[退役予定](https://platform.claude.com/docs/en/about-claude/model-deprecations)、[Fable 5.2移行ガイド](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide)、[Sonnet 5.5移行ガイド](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide)、[Haiku 5.5移行ガイド](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)。`POST /v1/messages` の `x-api-key` とSDKの `anthropic-version: 2023-06-01` を使用。必須は `model` 文字列、`messages` 配列、整数の `max_tokens`。SDKはストリームに `stream: true`、必要時に `tools` と `system` を送る。新モデルではsamplingを省略する。エージェントはツールを強制せず、assistant prefillも使わない。SDK 4.0.106は追加した3モデルを認識する。Mythosは組織承認制。認証・権限・未知ID・レート制限はAPIの `error.type` と `error.message` を既存経路で扱う（401/403、404、429）。
- [Gemini のモデル一覧](https://aistudio.google.com/docs/models#gemini-4)、[リリースノート](https://aistudio.google.com/docs/changelog)、[Hydrogen移行ガイド](https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen)、[Carbon移行ガイド](https://aistudio.google.com/docs/whats-new-gemini-4-carbon)、[Argon移行ガイド](https://aistudio.google.com/docs/whats-new-gemini-4-argon)。SDK 4.0.122の `POST /v1beta/models/{model}:streamGenerateContent?alt=sse` と `x-goog-api-key` を使用。モデルIDはURL、必須本文は `contents` 配列。関数宣言は `tools`、整数の出力上限は `generationConfig.maxOutputTokens` に設定可能。samplingは省略し、ツール実行ステップ間はSDKが返却されたthought signatureを再送する。追加の長時間実行APIは使わない。旧3.5 Flashは3.6 Flashへの互換ルーティングを継続しているため候補に残し、samplingの扱いを転送先に合わせる。無効キー・権限・未知ID・レート制限はGoogleの `error.code/message/status` を既存経路で扱う（400/403、404、429）。
- Go。公式IDと既存生成APIで実行可能。エージェントはツール実行中にsystem promptを更新するため、Claudeの新モデルでは署名付きthinkingのprefix不一致を許容するSDKのオプションを送る。Claude Fable 5.2が保持設定により返す400は接続先の制約として扱う。

## 検証方針

- 実装前に、モデルAPIの公開結果、サーバーでのモデル選択、samplingの抑止、内蔵4ロールの期待値、SDKの送信先と本文を検証するテストを追加または更新する。
- Geminiではモックストリームのツール呼び出しとthought signatureの再送、ClaudeではモックHTTPのprefix設定・sampling・ツール指定を確認する。
- Vitest全体、typecheck、差分チェックを実行する。実モデルは既存の契約をそのまま利用する場合は呼び出さない。

## 完了条件

- 新しいモデルを既存の設定とチャットのモデル選択で利用できる。
- 既存モデルと保存済みの設定を解決できる。
- READMEと製品仕様が実装と一致し、検証結果と未確認事項が記録されている。

## 実施結果

- AI SDKを`ai@7.0.176`、`@ai-sdk/openai@4.0.121`、`@ai-sdk/anthropic@4.0.106`、`@ai-sdk/google@4.0.122`、`@ai-sdk/deepseek@3.0.88`に更新。固定バージョンで`bun install --frozen-lockfile`が成功。
- 実装前のカタログ・選択・Claude prefix契約テストは、新IDやprefix設定がまだないため失敗した。実装とSDK更新後、`bun run test`は1,249件成功、既定の6件スキップ。新SDKが終端イベントなしのEOFに返す`interrupted`をSIWC契約テストに反映し、既存の切断判定も確認した。
- `bun run typecheck`、`bun run build`、`git diff --check`が成功。`bun run test:e2e -- e2e/app-shell.spec.ts e2e/siwc-workflow.spec.ts`は16件成功。READMEと仕様のモデルIDをカタログと照合した。
- OpenAIとGeminiは既存の生成APIを利用するため、実サービスを呼ばずにSDKのリクエストとモック応答を確認。Claudeの3モデルは合成入力で実サービスの疎通を試行したが、HTTP 400で拒否された。同一認証の再確認でクレジット残高不足を確認したため、実モデルでのツール実行、ストリーム完了、usageは未確認。betaヘッダーとthinking設定の送信はモックで確認した。
- デスクトップ固有の起動・通信・ネイティブ境界に変更がないため、`bun run test:desktop`は未実施。
