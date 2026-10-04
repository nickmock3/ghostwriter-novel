# 推論表示は公開要約の受信とターン識別を分けて確認する

## When this matters

チャットの推論途中経過、OpenAIのreasoning設定、Codexの通知変換を変更するとき。

## Field note

OpenAI Responsesは要約のopt-inが必要だが、`reasoningSummary: auto`を設定しても全リクエストで要約が返るとは限らない。SDKの既定設定はModelProvider内のmiddlewareで指定できる。実接続でGPT-5.4-miniの短い質問は回答だけ、同じ質問でreasoningEffortをmediumに指定すると推論要約も受信できた。表示の都合で本番の推論強度を一律に上げる必要はない。

Codex App Serverの通知は`turn/start`の応答より先に届くことがある。公開要約の`item/reasoning/summaryTextDelta`はthreadId、turnId、itemId、delta、summaryIndexを持つ。turn IDがまだ不明な段階で無条件に転送せず、応答を待ってターンを照合する。itemIdとsummaryIndexの組で段落の境界を識別できる。

## Reliable procedure

- インストール済みCodexの`app-server generate-ts --out <一時ディレクトリ>`で通知とTurnStartParamsを確認する。今回の確認版は`0.155.0-alpha.16.4`。
- SDKのfullStreamの`reasoning-delta.text`とCodexの公開summary deltaだけを共通イベントへ変換する。provider metadataやCodexのraw reasoning通知を合わせて転送しない。
- accumulatorの保存用結果に推論が混入しないテストと、モデルが推論を返さなくてもUIが待機状態を維持するテストを分ける。
- 実接続確認は架空の短い入力を使い、本文ではなく推論・回答の受信文字数だけ記録できる。

## Failure signals

- 推論非対応や未出力を通信障害と取り違える。
- 最初の通知が消える、他ターンの通知が混入する、段落同士がつながる。
- 推論が回答本文・会話JSONに混ざる。

## Recheck when

AI SDK、OpenAI SDK、Codex CLI、通知順序や会話の状態保持を変更したとき。

## Related work

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI reasoning summaries](https://developers.openai.com/api/docs/guides/reasoning#reasoning-summaries)
