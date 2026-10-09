# ペイン専用ボタンのCSSは共通buttonルールの詳細度を確認する

## When this matters

アシストなどの補助ボタンや無効状態の見た目を変えるのに、CSSを追加しても枠線・太字・背景が変わらないとき。

## Field note

`foundation.css`の`button:not(...)`や`workspace.css`の`button.secondary-action`は単独クラスより詳細度が高い。後で読み込まれるCSSでも、`.ai-assist-manage-open`だけでは背景・枠線・太字の変更が負ける。幅や文字サイズだけ変わるため、差分だけでは見落としやすい。

## Reliable procedure

ブラウザの画面とcomputed styleで適用結果を確認する。既存ペインクラスでスコープを付ける（例: `.ai-assist-pane .ai-assist-manage-open`）と、共通ルールを変えずに専用スタイルを優先できる。無効状態も実行可能・実行中と合わせて確認する。

## Failure signals

管理ボタンの幅は小さくなったのに、枠線や太字が残る。無効状態のopacityだけ適用され、背景色が変わらない。

## Recheck when

共通buttonルール、CSSの読み込み順、ペインのクラスを変更するとき。
