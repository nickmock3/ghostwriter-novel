# 新しいOpenAIモデルはAI SDKのID判定を確認する

## When this matters

OpenAIの新しいAPI model IDを固定カタログへ追加するとき。

## Field note

`@ai-sdk/openai`はmodel IDからreasoning可否などを判定する。任意文字列のIDが型上通っても、新世代が正しく認識されるとは限らない。GPT-6追加時の`3.0.63`はGPT-6をreasoningとして扱わず、`3.0.117`は対応していた。

## Reliable procedure

インストール済みSDKのmodel capabilities判定とResponses API経路を確認する。新モデルで`temperature`を渡したままtool付きの実行を行うテストを作り、送信先が`/v1/responses`で、拒否されるsamplingパラメータがbodyから除かれることを偽fetchで確認する。モデルメタデータの`supportsTemperature: false`も別に確認する。

## Failure signals

候補一覧や型チェックは通るが、実APIで`temperature`やtool呼び出しの400が返る。SDKの文字列ID許容だけを根拠に追加すると見落とす。

## Recheck when

`@ai-sdk/openai`のバージョン、provider生成方法、モデルID世代を変更したとき。
