# 接続の既定値変更では自動保存前の明示設定を識別する

## When this matters

新規利用者だけの接続既定値を変更し、既存のモデル選択や会話bindingを保持するとき。

## Field note

設定hookは候補取得後の正規化結果を自動保存する。画面が開いた後にlocalStorageの有無だけを見ると、自動生成したAPIモデルの既定値まで「既存利用者の選択」に見える。初期化時に既存設定の有無を専用キーへ記録してから、通常の設定保存を始める。

設定hookを`llm`へ移す場合も、SIWCの移行意図の記録は自動保存より前に呼ぶ。`llm`から上位の`siwc`へ依存させる代わりに、Appのcompositionで`initializeAiConnectionPreferences`を初期化し、その後に`useLlmSettings`を組み立てる。effectへ遅らせると、子画面が初期レンダーで接続を判定する時点に間に合わない。

接続の選択とモデル一覧の取得成功は別の状態にする。認証切れで一覧が空になっても、接続や選択モデルを削除しない。保存済み会話のbindingは個人設定より優先する。

接続を廃止する場合も、保存schemaから識別子を即座に削除すると、旧設定のdecode失敗が既定の別接続への変更につながる。旧識別子は読取り互換として受理し、実行入口で拒否する。送信だけでなく圧縮とAIアシストも確認し、新規作成APIの許可値は現行接続へ絞る。

## Reliable procedure

- 設定を読み込む前後、providersが空から利用可能になる時点、設定画面のlogin完了、画面移動・再読込を別々にテストする。
- 未ログイン・モデル取得失敗・preview無効・別アカウント時には送信停止を検証し、APIキー側へ送っていないことを確認する。
- 接続を保持するようになったコンポーネントテストは各テストのlocalStorageを隔離する。
- `e2e/support/siwc-server.ts`はOAuth資格情報と外部HTTP/SSEだけを合成し、実API router・runAgentLoop・Apply/Undo・保存を使う。ブラウザのAPI要求をその専用HTTPサーバーへproxyすると、通常devデータを使わず画面から保存まで検証できる。

## Failure signals

- 新規利用者なのにAPIキー接続が選ばれる。
- logoutや一覧失敗で別接続が選ばれる。
- 1件ずつ成功するUIテストが一括実行で別runtimeになる。
- 表示はChatGPTなのに送信bodyのprofile/modelがAPIキー側のままになる。

## Recheck when

設定保存の初期化順序、会話の復元、モデル候補API、接続キーやプロフィールの移行方式を変更するとき。
