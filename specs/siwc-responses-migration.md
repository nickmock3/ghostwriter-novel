# SIWC Responses直接接続仕様

## 現在の状態

認証・Responses接続・チャット・AIアシスト・圧縮・設定UIは実装済み。previewは既定OFFで、`GHOSTWRITER_ENABLE_SIWC_PREVIEW=1`を指定した場合だけ利用できる。APIキー接続を維持し、旧Codex CLI接続は撤去済み。旧履歴の読取り・既存編集案のApply/Undoを維持し、旧会話への追加AI実行・圧縮は拒否する。

現行UIは単一のChatGPT接続を扱う。ログインと新規利用時のChatGPTプラン既定選択は実装済みで、既存の明示設定・会話bindingを上書きしない。アカウント追加・切替UIは提供しない。保存形式と内部APIの互換性は維持する。

検証の到達点と公開前の残作業は[SIWC検証と公開状況](../docs/siwc-validation-status.md)にまとめる。macOS/Windowsの確認済み結果を採用し、最新versionという理由だけで同じ実機検証をやり直さない。[過去の移植計画と実験記録](../docs/archive/siwc-responses-migration.md)は現行要件ではない。

## SDKの方針

現在の固定versionは以下。正本は`package.json`と`bun.lock`。更新時は影響するアプリ側契約を確認し、SDK更新だけを理由として全providerの実接続smokeを必須にしない。

| package | 固定version |
| --- | --- |
| ai | 7.0.127 |
| @ai-sdk/openai | 4.0.83 |
| @ai-sdk/anthropic | 4.0.71 |
| @ai-sdk/google | 4.0.87 |
| @ai-sdk/deepseek | 3.0.58 |

SDK 7はNode.js 22以上・ESMを前提とする。Bun sidecarとNode/Vitestの確認を別々に行う。互換aliasの一括置換だけを目的とした変更は行わない。SDK契約テストはV4の型とstreamイベントを対象にする。

## 接続境界の設計

- `AgentRuntimeBackend`は`vercel-ai`を使用し、既存`runAgentLoop`・tool service・Apply/Undoを再利用する。別のエージェントループを移植しない。
- SIWCはAPIキー版OpenAIから区別できる接続として追加する。IDは`openai-chatgpt`。通常のAPIキーや任意base URLをSIWC接続へ渡さない。
- `LlmProviderPlugin`はOAuth認証方式を区別し、認証済みの動的モデル一覧・利用可否を扱う。UIの設定ポリシーは`connectionSettingsPolicy: "none"`とし、SIWCにAPIキーを要求しない。
- provider固有の送信変換はModelProvider内へ、認証・資格情報の保存はBun側の独立featureへ置く。Reactへ渡すのは登録の公開summary、状態、モデル候補、分類済みエラーのみ。
- `/v1/models`は現在の登録で取得する。`visibility: list`のslug/display_nameを使用する。モデル一覧はキャッシュせず、取得結果に登録IDを付ける。モデル一覧の成功を推論権限の保証にしない。
- 外部CodexもローカルMCPもSIWC直接接続には不要。既存Codex会話を自動でSIWCへ変更せず、切替は新しい会話からとする。
- main/writing/compactionの各役割が使う接続を明示し、SIWC失敗時にAPIキー版へ自動fallbackしない。独立した役割設定による意図した接続と失敗時fallbackを混同しない。

## 認証の境界

- OSSのOAuth/OIDC、callback、登録、logout、Zod検証と隣接テストを再利用する。refreshの最終実装と検証記録は`5da1218`まで照合済み。
- Ghostwriter専用保存先・host ID・client登録を使う。playgroundやCodexの資格情報をコピー・参照しない。
- アプリ名、browser起動、保存先、callback listener、キャンセルをGhostwriterへ接続する。通常のsidecar認証が必要なAPIと、OAuth state/nonce/PKCEで守るcallbackを区別する。
- refreshは同一セッションで直列化し、tokenローテーションをatomicに保存する。model生成時の古いtokenを後続toolステップで再利用しない。
- CLIの会話全体lockをGUIへそのまま移さない。実行中のlogoutと、チャット・AIアシスト・子エージェントの並行処理を調停する。旧アカウントの応答が新アカウントへ混入しないことを検証する。
- macOSのファイル保護とWindows ACL、配布版loopback callbackをそれぞれ確認する。未検証OSへ安全性の保証を拡張しない。

## 推論と履歴の契約

1. `store: false`、stream、developer指示、必要履歴の配列inputを明示する。HTTPの`previous_response_id`は使用しない。
2. 現行runAgentLoopのmaxOutputTokens/temperatureをSIWCには送信しない。UI上も非対応設定を有効に見せない。
3. function toolsをnamespaceへまとめる。provider metadata、call ID、tool結果、reasoningの整合を保ち、toolsのactive制限を壊さない。
4. `include: [reasoning.encrypted_content]`をモデル名のSDK判定に依存せず指定する。
5. SDK 7の`response.messages`は最後のステップのみ。全体は`responseMessages`。追質問には全ステップのtool・reasoning履歴を渡す。
6. 現行Ghostwriterの`modelMessages.ts`はアプリ履歴・compact tool resultから文脈を再構成する。OSSのメモリ履歴を並列の正として追加せず、必要なprovider metadataの永続化・再開・圧縮規則を定義し、旧会話も読めるschemaにする。
7. `finishReason: stop`だけでは正常完了を保証しない。各推論ステップのresponse.completedとfailed/incomplete/切断を区別する。理由欠落incompleteがstopになるのは合成fixtureでの防御的確認で、実サービスでの発生証拠ではない。
8. tool呼び出し自体は終端前に実行され得る。後続推論の停止だけで編集副作用を取り消した扱いにしない。自動Apply済みproposalの先行保存とUndoを維持し、失敗ターンの自動再送を行わない。
9. AIアシスト・圧縮がgenerate系APIを使う場合も、SIWCのModelProviderがHTTPをstreamへ変換し、正常終端を確認して最終schema検証へ返す。本文生成にもsampling/output上限の除外・正常終端検証を適用する。

## SDK契約テスト

`src/features/siwc/siwcSdkCompatibility.test.ts`に、OSS検証から移植した14件の偽HTTP/SSEテストを置く。MIT noticeを保持する。資格情報・実応答は使用しない。

- 公開Responses URL、POST、Bearer、developer、store/stream、禁止フィールド省略。
- namespace function実行、schema不適合時の非実行、call IDに対応する結果返送。
- 全ステップのtool・暗号化reasoningを追質問へ再送。
- 正常完了、不完全終了、終端なしEOF、利用枠エラー、通信例外の区別。
- HTTP 401/403/429/503のdetail応答、maxRetries/streamRetriesを0にした非再送。
- アプリ側ステップ上限による後続推論停止。

これらはSDKの公開設定で構築できる契約を保証する。本番runAgentLoopへのSIWC統合、実サービスの権限、実LLM品質、refreshは保証しない。

## 公開方針

旧commit履歴を持ち越さず、コード・仕様・テストを別リポジトリでOSS公開する方針。公開者名・Store識別子・ライセンス帰属情報は保持する。個人パスとローカルファイル除外の修正は完了している。移行時の確認事項は[OSS公開前のファイル監査](../docs/oss-publication-audit.md)を参照する。

公開条件の適合確認・新repoへの移行・公開判断は未完了。既定OFFは維持する。完了した実接続検証を再び必須残作業として追加しない。

## 参照

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0

プレビューのため実装時に再確認する。

## 認証基盤の実装

OSS `9e498f8` / refresh実装 `8771a41` の認証・OIDC・登録・logout・refreshとテストを`src/features/siwc/`へ移植した。MIT noticeは同ディレクトリのLICENSEに保持する。`jose`は6.2.12をexact指定。GhostwriterのdataRoot内`siwc/credentials.json`に独立したhost ID・client登録を作成し、他アプリの資格情報は参照しない。

`SiwcService.withRun`はrun全体のleaseを持ち、アカウント変更・logout・loginをbusyで拒否する。複数runは並行可能で、各HTTP送信前の資格情報transactionだけ直列化する。別processの変更は次の送信前に登録IDで検出する。モデル一覧はキャッシュせず、結果に登録IDを付ける。各runを終了するとそのfetchは使用不可になる。呼出元はストリーム消費・tool実行が完了するまでwithRun内に留める。

`/api/siwc/status`, `/models` はGET、`/login`, `/login/cancel`, `/select`, `/logout` はJSON POST（いずれも`/api/siwc`配下）。`/select`と複数登録を扱う保存形式は内部互換として残るが、利用画面から追加・切替は提供しない。通常は404で、開発者が`GHOSTWRITER_ENABLE_SIWC_PREVIEW=1`を明示した場合だけ有効。同じ設定でUI・モデル候補・チャット・AIアシスト・圧縮を有効にする。loginはシステムブラウザを開き、完了まで応答を待つ（最大4分）。callback listenerは専用loopbackでstate/nonce/PKCEを検証する。通常APIはsidecarのBearer/Origin境界内にあり、Web版でも別origin・単純form POSTを拒否する。

保存はPOSIX owner-only（directory0700/file0600）、atomic renameとprocess間lockを使用。Windowsでは新規directoryの作成時から継承を切り、実行ユーザーSIDだけのFullControl（子へ継承）を設定する。読み書き時にdirectory/fileの所有者・許可先を検証し、既存の広いACL、保存先と祖先のreparse point、資格情報のhardlinkを拒否する。既存ACLは自動修復しない。一時fileのACLを秘密情報の書込み前に確認し、file flush→close→renameで置換する。Windowsではdirectory fsyncを行わず、置換失敗時に旧fileを先に削除するfallbackは使わない。lockが残った場合はbusyとなり、自動削除・token再送はしない。

Windowsの保護はファイルアクセス制限であり暗号化ではない。同一ユーザー権限の別プロセスや管理者からの保護は保証しない。AI toolによる読取りは共通workspace境界でも拒否する。Windows PowerShell 5.1 / .NET FrameworkのDirectorySecurityを用い、固定スクリプトへpathをstdinのJSONデータとして渡す。helperの例外本文は公開せず、権限不適合はunsafe_storage、helper実行失敗はstorageへ分類する。

Windowsの外部ブラウザ起動は固定PowerShellスクリプトへURLをstdinで渡し、ProcessStartInfo.FileNameとUseShellExecuteで既定のHTTPS関連付けを使う。URLをコマンド文字列へ連結しない。macOSのopen/Linuxのxdg-openも含め、auth.openai.comのHTTPS URL・userinfoなしだけを受け付ける。起動失敗はauthorization_failedとして返す。Windowsの実OAuth・配布版での確認結果は検証状況文書に記録済み。

Windowsの資格情報チェックとブラウザ起動の補助PowerShellは、windowsHideに加えて`-WindowStyle Hidden`を指定する。状態確認のためにコンソールを利用者へ表示しない。非表示化のためにACL検証を省略しない。

Tauri WebViewからloopbackへの通信は`Sec-Fetch-Site: cross-site`でも、外側sidecarのBearerと許可Origin検証を通るnative originならSIWC APIで受け付ける。Webのcross-site拒否、不正Bearer・外部Originの拒否は維持する。

実装判断の参照: Microsoftの[DirectorySecurity](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.directorysecurity)と[Process.Start](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.start)。自動テストの合成OAuth/HTTPと実アカウントの検証は[検証状況](../docs/siwc-validation-status.md)で区別する。

refreshは実装と偽API検証を取り込み、OSS側の実通信成功記録も確認済み。ローテーション送信前に不確実状態を保存し、応答を失ったtokenの再使用を拒否する。送信後にキャンセルされても後継tokenの保存を完了する。earliest_refresh_at（Unix秒/タイムゾーン付き日時/null）の扱いと、ID token省略時の維持はOSSの公式DevKit調査に基づく。OSS側の実通信記録と最終差分の確認は完了。Ghostwriter独立登録での自動refresh・更新後推論も実接続確認済み。

## アプリ統合

- `siwcResponses.ts`でSDK設定をallowlist化し、developer指示・namespace tools・store=false・encrypted reasoning・streamを強制する。generateObjectもHTTPをstreamへ変換して最終schema検証へ返す。
- 各stepのraw終端でcompletedを確認し、failed/incomplete/EOFは分類済みエラーとする。再送可能なSDK例外を外へ渡さず自動retryを防ぐ。tool後の失敗は既存の先行保存・Undoを使う。
- `runSiwcAgentChat`は認証lease内で既存application serviceを起動する。圧縮・子エージェント・本文生成・tool・保存の終了までleaseを維持し、trusted extensionsも引き継ぐ。別のループは作らない。
- 会話の`siwc`へaccountId/modelIdを保存する。空のvercel-ai会話のみ紐付けられる。旧Codex会話は履歴を保持し、追加実行と圧縮を拒否する。別接続の利用には新しい会話を作成する。
- assistantの`siwcHistory`へ当該ターンのSDK `responseMessages`を保存する。旧JSONも読める任意fieldとし、Zodでtool call/resultと必要なOpenAI metadataを検証する。token/HTTP headersは保存せず、別アカウントへ再送しない。失敗した不完全ターンは従来の本文・compact tool結果から再開する。
- 選択モデルをmain/writing/search/simpleの既定とする。base URL・temperature・最大出力token設定はSIWCでは編集UIを無効化する。AIアシストの明示的SIWC選択と、会話bindingに基づく手動/自動圧縮に対応する。
- 利用不可時のプロフィール正規化・保存済みモデル選択でAPIキーへfallbackしない。

## ローカル確認手順（macOS）

資格情報と原稿の保存先を分ける。実認証はユーザーがブラウザで操作し、検証OSSやCodexのtokensをコピーしない。

```sh
GHOSTWRITER_ENABLE_SIWC_PREVIEW=1 \
GHOSTWRITER_DATA_DIR="$HOME/Library/Application Support/Ghostwriter SIWC Preview" \
bun run dev
```

1. 設定の「ChatGPT プラン（おすすめ）」から「ChatGPTでログイン」を選び、システムブラウザで認証する。
2. チャットで「ChatGPTプラン」と取得されたモデルを選ぶ。新規利用者はこの接続が既定となる。既存会話から接続を変更すると新しい会話になる。
3. Read・提案・未保存時の拒否・Apply・Undo・追質問・再起動後の継続を確認する。
4. AIアシスト・圧縮・実行中の認証変更拒否・logoutを確認する。
5. このアプリの独立登録でもrefresh後の推論を確認する（別OSSの最終成果は照合済み）。

`dataRoot/siwc`と重なるワークスペースは共通入口で拒否する。symlink aliasもrealpathで検出する。SIWCを無効にした後も保存ディレクトリが存在すれば保護する。原稿とdataRootを別ディレクトリに置く。

## ローカル確認手順（Windows preview）

Windowsでのpreview起動には、PowerShellで次を指定する。資格情報用の`siwc`子ディレクトリはアプリが本人限定ACLで作成するため、手動作成しない。原稿はこのdataRootとは別の場所へ置く。既存ACLが不適切なら自動で権限を書き換えず停止する。

```powershell
$env:GHOSTWRITER_ENABLE_SIWC_PREVIEW = "1"
$env:GHOSTWRITER_DATA_DIR = Join-Path $env:LOCALAPPDATA "Ghostwriter SIWC Preview"
bun run dev
```

Windows PowerShell 5.1が実行できる環境を前提とする。設定画面からログインを開始してブラウザで認証する。この手順は必要時の確認用であり、確認済みの両OS実機検証を毎回要求するものではない。


## ログイン操作

未登録・サインアウト時は「ChatGPTでログイン」、期限切れ・再認証必要・推論許可不足時は「もう一度ログイン」、有効なサインイン済み状態は「ログアウト」を表示する。選択中の登録があればloginへaccountIdを渡して再利用し、未登録時だけ新規登録する。ログイン中は追加のログイン操作を表示しない。

アカウント追加・切替・詳細設定は提供しない。別アカウントを使う場合はlogout後にloginする。認証切れ・推論許可不足でもlogoutできる。処理中・loginPending時は認証変更操作を無効にし、ログイン待ちのキャンセルは利用可能にする。保存形式を単一登録へ破壊的移行せず、会話bindingの保護を維持する。
