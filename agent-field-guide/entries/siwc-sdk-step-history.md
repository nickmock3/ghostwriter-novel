# SIWC移植時はSDKの全ステップ履歴と正常終端を分けて確認する

## When this matters

SIWC検証コードをGhostwriterへ移す、またはAI SDKのメジャーバージョンを更新するとき。

## Field note

ai 6.0.176で成功したtool往復・追質問テストは、ai 7.0.127への更新後に`result.response.messages`のままだと追質問のtool・reasoning履歴が欠落した。SDK 7では最後のステップのresponseであり、全ステップの履歴は`result.responseMessages`で取得する。型チェックだけではこの意味の差を検出できない。

SIWCはHTTP側の保存済みresponse IDによる継続を使わないため、必要な履歴の再送を実際のHTTP inputで検証する。SDK 7 / openai 4.0.83では公開provider optionsによるnamespace、store:false、developer変換、暗号化reasoningの再送を合成HTTP/SSEで確認できた。実サービス・本番統合の保証ではない。

## Reliable procedure

- tool応答→tool結果付き推論→追質問の3要求を偽fetchで観測し、最後のinputにもfunction_call、function_call_output、reasoningがあることを確認する。
- モデルID判定に依存せずreasoning.encrypted_contentを明示する。
- completed、incomplete、failed、終端なしEOFを別々に送る。理由欠落incompleteがfinishReason:stopになる合成ケースがあるため、成功判定をfinishReasonだけにしない。
- Ghostwriterの永続履歴・圧縮は別境界なので、OSSのメモリ履歴をコピーしただけで再開を保証しない。

## Failure signals

単発推論と最初のtool往復は成功するのに追質問だけ文脈が失われる。型チェックが成功してもSDK更新で発生し得る。

## Recheck when

SDKのバージョン、履歴保存、tool namespace、正常終端判定を変更するとき。

## Related work

- `src/features/ai-agent/llm-providers/siwcSdkCompatibility.test.ts`
- `specs/siwc-responses-migration.md`
