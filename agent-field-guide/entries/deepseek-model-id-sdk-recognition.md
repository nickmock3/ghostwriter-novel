# DeepSeekの新IDではSDKのthinking履歴判定を確認する

## When this matters

DeepSeekの新しいAPI model IDを固定カタログへ追加するとき。

## Field note

`@ai-sdk/deepseek`はモデルIDからthinking履歴の送信方法を切り替える。`2.0.34`はV4系を`deepseek-v4`という部分文字列で識別し、V4.1 Flashの正式ID`deepseek-flash`を認識しなかった。`2.0.64`は正式IDを認識する。

## Reliable procedure

新モデルの正式IDと、インストール済みSDKのmodel family判定を照合する。thinkingとtoolを使う会話では、過去のassistant messageに必要な`reasoning_content`が送られるか確認する。ID文字列を受け付けるだけで互換と判断しない。

## Failure signals

単発のモデル呼び出しや型チェックは通るが、tool resultを含む次のターンでAPIエラーになる。

## Recheck when

`@ai-sdk/deepseek`のバージョン、DeepSeekのモデルID、thinking/toolの会話経路を変更したとき。
