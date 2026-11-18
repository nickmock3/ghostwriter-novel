# ureq更新時はsidecarのループバック通信でプロキシ設定を確認する

## When this matters

Rust側のsidecar health checkや、そのHTTPクライアントを更新するとき。

## Field note

このプロジェクトで使っていたureq 2のfeature構成では環境プロキシを読まなかった。ureq 3の既定設定は環境プロキシを読むため、接続先URLのhostが`127.0.0.1`でも、プロキシが設定された環境では直接接続を保証できない。認証付きhealth checkのリクエストで`.config().proxy(None).build()`を指定する。

## Reliable procedure

通常のsidecar smokeに加えて、`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`と小文字の各変数を到達不能なループバックポートに向け、`NO_PROXY`と`no_proxy`を空にしたコマンド単位の環境で、同じsmokeを実行する。smokeが起動した子プロセスに認証付きのhealth checkが届くことを確認する。

## Failure signals

通常の環境ではsmokeが通るが、プロキシを設定した環境ではsidecarは起動してもhealth checkが失敗する。

## Recheck when

ureqのバージョン、feature、設定スコープ、health check用クライアントを変更するとき。
