# AI生成の停止はストリームイベントと実行ステップを分けて調べる

## When this matters

長文や複数章の生成が途中で終わる、またはツール実行中のままに見えるとき。

## Field note

AI SDKの`fullStream`は失敗を`error`イベントとして返す経路がある。外側の`try/catch`だけでは、この経路の失敗を会話へ通知できない。イベント変換で`error`や`tool-error`を捨てていないか確認する。

文字数・コンテキスト制限とは別に、`AgentProfile.stopWhen`が実行を終了させる。`stepCountIs`が数えるのはモデル呼び出しのステップであり、ファイル数や個別ツール呼び出し数ではない。途中でファイルを保存してもステップ数はリセットされない。

## Reliable procedure

- インストール済みSDKの`stream-text.ts`でエラーイベントと継続条件を確認する。
- `mapAgentStreamPart`へ合成した`error`と`tool-error`を入力し、呼び出し側まで伝わるか確認する。
- 使用中プロフィールの停止条件を境界値で評価する。
- `DelegateWriting`は`streamWritingObject`で部分objectの本文文字数を通知する。本文未受信の待機と実際の終了を区別する。
- `streamObject.partialObjectStream`はerrorイベントを抑制するため、`fullStream`でerrorとfinishを明示的に確認してから最終objectを待つ。finish欠落時に結果promiseを待ち続けない。
- tool実行中の進捗はtoolCallIdに紐づくobserverで送る。通常tool resultやモデルのmessagesへ混ぜない。

## Failure signals

ツールの後に最終説明がない、エラー通知がないまま終了する、複数ファイルの途中までしか作成されない。

## Recheck when

AI SDK、ストリームイベント変換、実行停止条件、本文生成方式を変更したとき。
