# 空の.env.local雛形は移行した.envを上書きする

## When this matters

セットアップで`.env.example`を`.env.local`へコピーした後、別checkoutの`.env`を移行するとき。

## Field note

`vite.config.ts`は`loadEnv(mode, cwd, "")`の結果を`process.env`へ反映する。`.env.local`の空のAPIキー項目が`.env`の設定済み値より優先され、providerが未設定になる。正式名の既定provider/modelも、移行した旧名の設定より優先される。

## Reliable procedure

1. 値を出力せず、両ファイルの変数名と空か設定済みかを比較する。
2. `.env.local`が作成時の雛形と同一か確認する。利用者の変更があれば一括退避しない。
3. 未変更の雛形だけを`.env.local.initialization-backup`などGit除外対象へ退避し、開発サーバーを再起動する。
4. `/api/llm/providers`のモデル利用可否で設定の反映を確認する。実LLMを呼ぶ必要はない。

## Failure signals

`.env`へキーを移行したのに、画面がAPIキー未設定と表示する。既定モデルも移行元と異なる。

## Recheck when

環境変数の読み込み順、正式名と旧名の優先順位、セットアップ手順を変更したとき。
