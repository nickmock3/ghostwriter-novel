> 過去の計画・検証記録。2026-10-05の文書整理前の内容を保存したもの。現在の仕様・残作業は[仕様索引](../../specs/README.md)を参照し、この文書の未完了記述を現行要件として扱わない。

# SIWC Responses直接接続の移植計画

## 状態と根拠

2026-10-04時点。SDK更新・認証・Responses接続・設定UIを実験版として実装済み。既定は無効。APIキー接続を維持する。旧Codex CLI接続はタスク231で廃止する。製品の主導線はユーザー指定により「ChatGPTでログイン」とし、230で初回案内と新規利用時の既定選択を整える。既存の明示選択・会話bindingは変更しない。

参照元は別OSS `chatgpt-plan-playground` のコミット`0105676`、`specs/live-validation.md`、`specs/siwc-sdk-validation.md`、`docs/porting.md`。同リポジトリでは認証、再認証、推論、tool結果返送、追質問、中断、logoutのmacOS実接続を確認済み。refreshの最終成果は2026-10-04に`5da1218`まで照合済み（後述）。検証リポジトリと資格情報は変更していない。

## SDKの方針

ユーザー指示に従い最新安定版を使用する。2026-10-04のnpm registry `latest`を確認し、次をexactで固定した。無関係な依存は更新しない。

| package | 更新前 | 更新後 |
| --- | --- | --- |
| ai | 6.0.176（manifestはlatest） | 7.0.127 |
| @ai-sdk/openai | 3.0.117 | 4.0.83 |
| @ai-sdk/anthropic | 3.0.77 | 4.0.71 |
| @ai-sdk/google | 3.0.71 | 4.0.87 |
| @ai-sdk/deepseek | 2.0.64 | 3.0.58 |

SDK 7はNode.js 22以上・ESMを前提とする。Bun sidecarとNode/Vitestの確認を別々に行う。互換aliasの一括置換だけを目的とした変更は行わない。今回、既存生成APIとstreamイベントのテストは成功し、SDKのtyped mockはV4へ更新した。

## 接続境界の設計

- `AgentRuntimeBackend`は`vercel-ai`を使用し、既存`runAgentLoop`・tool service・Apply/Undoを再利用する。別のエージェントループを移植しない。
- SIWCはAPIキー版OpenAIから区別できる接続として追加する。IDは`openai-chatgpt`。通常のAPIキーや任意base URLをSIWC接続へ渡さない。
- 現行`LlmProviderPlugin.envKey`と固定model一覧はAPIキー接続前提。OAuth接続を偽envキーで押し込まず、認証方式を区別し、動的モデル一覧・利用可否を扱う境界を追加する。
- provider固有の送信変換はModelProvider内へ、認証・資格情報の保存はBun側の独立featureへ置く。Reactへ渡すのは登録の公開summary、状態、モデル候補、分類済みエラーのみ。
- `/v1/models`は現在の登録で取得する。`visibility: list`のslug/display_nameを使用し、切替時にキャッシュを破棄する。モデル一覧の成功を推論権限の保証にしない。
- 外部CodexもローカルMCPもSIWC直接接続には不要。既存Codex会話を自動でSIWCへ変更せず、切替は新しい会話からとする。
- main/writing/compactionの各役割が使う接続を明示し、SIWC失敗時にAPIキー版へ自動fallbackしない。独立した役割設定による意図した接続と失敗時fallbackを混同しない。

## 認証移植の境界

- OSSのOAuth/OIDC、callback、登録、logout、Zod検証と隣接テストを再利用する。refreshの最終実装と検証記録は`5da1218`まで照合済み。
- Ghostwriter専用保存先・host ID・client登録を使う。playgroundやCodexの資格情報をコピー・参照しない。
- アプリ名、browser起動、保存先、callback listener、キャンセルをGhostwriterへ接続する。通常のsidecar認証が必要なAPIと、OAuth state/nonce/PKCEで守るcallbackを区別する。
- refreshは同一セッションで直列化し、tokenローテーションをatomicに保存する。model生成時の古いtokenを後続toolステップで再利用しない。
- CLIの会話全体lockをGUIへそのまま移さない。実行中のlogoutと、チャット・AIアシスト・子エージェントの並行処理を調停する。旧アカウントの応答が新アカウントへ混入しないことを検証する。
- macOSのファイル保護とWindows ACL、配布版loopback callbackをそれぞれ確認する。未検証OSへ安全性の保証を拡張しない。

## 推論・履歴で必要な変更

1. `store: false`、stream、developer指示、必要履歴の配列inputを明示する。HTTPの`previous_response_id`は使用しない。
2. 現行runAgentLoopのmaxOutputTokens/temperatureをSIWCには送信しない。UI上も非対応設定を有効に見せない。
3. function toolsをnamespaceへまとめる。provider metadata、call ID、tool結果、reasoningの整合を保ち、toolsのactive制限を壊さない。
4. `include: [reasoning.encrypted_content]`をモデル名のSDK判定に依存せず指定する。
5. SDK 7の`response.messages`は最後のステップのみ。全体は`responseMessages`。SDK 6用のアクセスをコピーすると追質問のtool・reasoningが欠けることを今回の契約テストで検出した。
6. 現行Ghostwriterの`modelMessages.ts`はアプリ履歴・compact tool resultから文脈を再構成する。OSSのメモリ履歴を並列の正として追加せず、必要なprovider metadataの永続化・再開・圧縮規則を定義し、旧会話も読めるschemaにする。
7. `finishReason: stop`だけでは正常完了を保証しない。各推論ステップのresponse.completedとfailed/incomplete/切断を区別する。理由欠落incompleteがstopになるのは合成fixtureでの防御的確認で、実サービスでの発生証拠ではない。
8. tool呼び出し自体は終端前に実行され得る。後続推論の停止だけで編集副作用を取り消した扱いにしない。自動Apply済みproposalの先行保存とUndoを維持し、失敗ターンの自動再送を行わない。
9. `aiAssistExecutionService.ts`と`conversationCompaction.ts`のgenerateObjectは非stream。SIWCで使う前にstream経路へ適応する。DelegateWritingのstreamWritingObjectもsampling/output上限の除外、正常終端、最終schema検証が必要。

## 今回のSDK契約テスト

`src/features/ai-agent/llm-providers/siwcSdkCompatibility.test.ts`に、OSS検証から移植した14件の偽HTTP/SSEテストを置く。MIT noticeを保持する。資格情報・実応答は使用しない。

- 公開Responses URL、POST、Bearer、developer、store/stream、禁止フィールド省略。
- namespace function実行、schema不適合時の非実行、call IDに対応する結果返送。
- 全ステップのtool・暗号化reasoningを追質問へ再送。
- 正常完了、不完全終了、終端なしEOF、利用枠エラー、通信例外の区別。
- HTTP 401/403/429/503のdetail応答、maxRetries/streamRetriesを0にした非再送。
- アプリ側ステップ上限による後続推論停止。

これらはSDKの公開設定で構築できる契約を保証する。本番runAgentLoopへのSIWC統合、実サービスの権限、実LLM品質、refreshは保証しない。

## 後続タスクと採用ゲート

- 227: OSSのrefresh成果を取り込み、サーバー側認証・資格情報・モデル一覧を移植。
- 228: SIWC providerと生成・履歴・編集サービスを統合。
- 229: UI・Tauri配布境界・実接続の検証後にSIWCを公開。

公開前には新しいGhostwriter登録で「認証→Read→編集提案→Apply→Undo→追質問→refresh後の推論→logout」を実接続で確認する。未保存file、競合、失敗後の非二重適用、ログアウト後に異なるアカウントで再認証した際の会話binding保護、APIキー接続への非fallbackも確認する。対象アプリのOSS提供条件は移植元の成功だけで満たしたとは扱わない。

## 参照

- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0

プレビューのため実装時に再確認する。

## 認証基盤の移植（227）

OSS `9e498f8` / refresh実装 `8771a41` の認証・OIDC・登録・logout・refreshとテストを`src/features/siwc/`へ移植した。MIT noticeは同ディレクトリのLICENSEに保持する。`jose`はregistryの最新安定版6.2.12をexact指定。GhostwriterのdataRoot内`siwc/credentials.json`に独立したhost ID・client登録を作成し、他アプリの資格情報は参照しない。

`SiwcService.withRun`はrun全体のleaseを持ち、アカウント変更・logout・loginをbusyで拒否する。複数runは並行可能で、各HTTP送信前の資格情報transactionだけ直列化する。別processの変更は次の送信前に登録IDで検出する。モデル一覧はキャッシュせず、結果に登録IDを付ける。各runを終了するとそのfetchは使用不可になる。呼出元はストリーム消費・tool実行が完了するまでwithRun内に留める。

`/api/siwc/status`, `/models` はGET、`/login`, `/login/cancel`, `/select`, `/logout` はJSON POST。通常は404で、開発者が`GHOSTWRITER_ENABLE_SIWC_PREVIEW=1`を明示した場合だけ有効。228/229の実験版統合により、同じ設定でUI・モデル候補・チャット・AIアシスト・圧縮を有効にする。loginはシステムブラウザを開き、完了まで応答を待つ（最大4分）。callback listenerは専用loopbackでstate/nonce/PKCEを検証する。通常APIはsidecarのBearer/Origin境界内にあり、Web版でも別origin・単純form POSTを拒否する。

保存はPOSIX owner-only（directory0700/file0600）、atomic renameとprocess間lockを使用。Windowsでは新規directoryの作成時から継承を切り、実行ユーザーSIDだけのFullControl（子へ継承）を設定する。読み書き時にdirectory/fileの所有者・許可先を検証し、既存の広いACL、保存先と祖先のreparse point、資格情報のhardlinkを拒否する。既存ACLは自動修復しない。一時fileのACLを秘密情報の書込み前に確認し、file flush→close→renameで置換する。Windowsではdirectory fsyncを行わず、置換失敗時に旧fileを先に削除するfallbackは使わない。lockが残った場合はbusyとなり、自動削除・token再送はしない。

Windowsの保護はファイルアクセス制限であり暗号化ではない。同一ユーザー権限の別プロセスや管理者からの保護は保証しない。AI toolによる読取りは共通workspace境界でも拒否する。Windows PowerShell 5.1 / .NET FrameworkのDirectorySecurityを用い、固定スクリプトへpathをstdinのJSONデータとして渡す。helperの例外本文は公開せず、権限不適合はunsafe_storage、helper実行失敗はstorageへ分類する。

Windowsの外部ブラウザ起動は固定PowerShellスクリプトへURLをstdinで渡し、ProcessStartInfo.FileNameとUseShellExecuteで既定のHTTPS関連付けを使う。URLをコマンド文字列へ連結しない。macOSのopen/Linuxのxdg-openも含め、auth.openai.comのHTTPS URL・userinfoなしだけを受け付ける。起動失敗はauthorization_failedとして返す。Windowsの実OAuth・配布版確認は引き続き公開前に必要。

Windowsの資格情報チェックとブラウザ起動の補助PowerShellは、windowsHideに加えて`-WindowStyle Hidden`を指定する。状態確認のためにコンソールを利用者へ表示しない。非表示化のためにACL検証を省略しない。

Tauri WebViewからloopbackへの通信は`Sec-Fetch-Site: cross-site`でも、外側sidecarのBearerと許可Origin検証を通るnative originならSIWC APIで受け付ける。Webのcross-site拒否、不正Bearer・外部Originの拒否は維持する。

実装判断の参照: Microsoftの[DirectorySecurity](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.directorysecurity)と[Process.Start](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.start)。Windowsの実ファイルACL・別process排他・保存復元、合成OAuth/refresh/logout、実ブラウザ起動処理、関連E2Eとdesktopの確認結果はタスク229の「Windows実装・検証結果」に記録する。実ChatGPT認証やMSIX配布版の成功とは区別する。

refreshは実装と偽API検証を取り込み、OSS側の実通信成功記録も確認済み。ローテーション送信前に不確実状態を保存し、応答を失ったtokenの再使用を拒否する。送信後にキャンセルされても後継tokenの保存を完了する。earliest_refresh_at（Unix秒/タイムゾーン付き日時/null）の扱いと、ID token省略時の維持はOSSの公式DevKit調査に基づく。OSS側の実通信記録と最終差分の確認は完了。Ghostwriter独立登録での実接続は229の必須ゲートとして残す。

## アプリ統合（228、229の実装部分）

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
4. AIアシスト・圧縮・実行中の切替拒否・logoutを確認する。
5. このアプリの独立登録でもrefresh後の推論を確認する（別OSSの最終成果は照合済み）。

`dataRoot/siwc`と重なるワークスペースは共通入口で拒否する。symlink aliasもrealpathで検出する。SIWCを無効にした後も保存ディレクトリが存在すれば保護する。原稿とdataRootを別ディレクトリに置く。

## ローカル確認手順（Windows preview）

Windowsでのpreview起動には、PowerShellで次を指定する。資格情報用の`siwc`子ディレクトリはアプリが本人限定ACLで作成するため、手動作成しない。原稿はこのdataRootとは別の場所へ置く。既存ACLが不適切なら自動で権限を書き換えず停止する。

```powershell
$env:GHOSTWRITER_ENABLE_SIWC_PREVIEW = "1"
$env:GHOSTWRITER_DATA_DIR = Join-Path $env:LOCALAPPDATA "Ghostwriter SIWC Preview"
bun run dev
```

Windows PowerShell 5.1が実行できる環境を前提とする。設定画面からログインを開始してブラウザで認証する。以下のmacOSでの過去検証と、タスク229のWindows実装検証を区別し、Windowsの実アカウント/配布版の完了確認は別に残す。

## アプリ統合の検証記録

2026-10-04、macOS、合成OAuth/HTTP/SSE・一時ワークスペースで確認。

- `bun run test`: 165 files、1464 passed / 2 skipped。
- `bun run typecheck`: 成功。
- `bun run test:e2e`: 全29件成功。SIWC設定はAPIモックの画面操作、既存Apply/Undoは実保存E2E。
- `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk bun run test:desktop`: web build・Rust/sidecar・desktop Vitest73件成功。
- SIWC結合: 実Read→Edit proposal→dirty拒否→Apply→Undo→保存履歴による追質問、autoApply後の切断とUndo、step間refresh、AIアシスト承認待ちproposal、手動圧縮、切替拒否を偽HTTPで確認。
- UIスクリーンショットで状態・選択・操作ボタンの表示を確認。
- 未実施: Ghostwriterの実OAuth/推論/refresh、配布版callback、Windows ACL・実機、他providerのlive品質比較。229をopenとして維持する。

## OSS refresh最終成果の照合（2026-10-04）

検証リポジトリの`9e498f8..5da1218`を確認。変更は検証スクリプトの`--keep-session`追加と結果文書のみで、`src/`の変更はない。移植済みのrefresh・credentials・store・logoutはライセンス注記を除いて一致し、accessはimport先のみ相違。refreshテストの差分もimport先・node環境指定・未対応Windowsのskipに限られるため、実装の追加取り込みは不要。

同リポジトリの`specs/refresh-validation.md`・`specs/live-validation.md`の記録では、更新可能時刻後の明示的refreshでaccess/refresh tokenの置換、期限延長、後継tokenの永続化、モデル一覧取得、更新済みBearerでの推論正常完了が成功（Responses要求1回）。その後のlogoutも遠隔失効・ローカルsession削除・登録とhost ID保持を確認し、005はdone。

これは検証リポジトリの実通信記録の確認であり、Ghostwriterでの実通信を今回実行したものではない。時刻到来による自動refresh起動と複数回連続の実ローテーションはOSSでも未検証。Ghostwriterでの独立登録・SDK 7統合・配布版・Windowsの確認は引き続き229で扱う。

今回の変更は文書のみ。新規テストは追加せず、ソース差分照合と既存refresh/logout/serviceテストを確認した。`bun run test -- src/features/siwc/refresh.test.ts src/features/siwc/logout.test.ts src/features/siwc/service.test.ts`は3ファイル50件成功。全体テスト・型チェック・E2E・desktopの再実行は、実装変更がないため省略した。資格情報へのアクセスや実サービスへの再送は行わない。

## Ghostwriter独立登録での実接続（2026-10-04）

ユーザーがWeb開発版の設定UIからシステムブラウザで初回ログインし、成功。専用dataRootに独立登録を保存。認証情報や実アカウント識別子は出力・記録していない。最新安定SDK（ai 7.0.127 / @ai-sdk/openai 4.0.83）、macOS / Bunで実施。

動的モデル一覧の取得後、提供された`gpt-5.6-luna`を使用。既存作品とは別の一時ワークスペースに「朝の港には、白い霧が漂っていた。」というテスト原稿を作成し、実サービスへ送信した。

- 既存の`runSiwcAgentChat`を通したRead→Edit提案が成功。editorモードで承認前の原稿は変化しない。
- dirtyPaths付きApplyは拒否。通常Applyで「白い霧」→「薄い霧」、Undoで原文一致を確認。
- 別の実行で保存会話を読み直して追質問し、変更前後の語を正しく回答。SIWC履歴も保存済み。
- AIアシスト（polish）の実生成はcompleted、proposalはpending、ディスク原稿は未変更。
- 同じテスト会話をAPI handler経由で手動圧縮し、HTTP200 / compacted。

認証は実UI、上記推論・編集・保存は実application service / 実ファイル / 実HTTPの検証である。全工程をブラウザ操作したE2Eや配布版Tauri実機の確認とは区別する。他providerへの実通信は行っていない。

今回の登録でrefresh可能時刻は10:47頃、現在の実装の期限直前自動更新は10:52頃（Asia/Tokyo）。未来の自動フォローアップ設定は自動承認レビューがスケジュール実行の明示許可不足として拒否したため、時刻待ち検証processも停止した。この時点ではrefresh、更新後推論、logoutは未実施だった。その後、ユーザーの明示許可で11:30に一度だけ自動再開し、以下の結果を得た。

## 配布物へのMIT notice同梱

Tauri bundle resourcesへ`src/features/siwc/LICENSE`を追加し、Windows MSIXでは`SIWC-LICENSE.txt`としてコピーする。MSIX layout検証でも欠落を拒否する。macOS上の設定・layoutテストで欠落時の失敗を先に確認してから修正した。Windows上の実MSIX生成と、macOS配布appの最終artifact確認は別途必要。

- `bun run test`: 165 files / 1465 passed / 2 skipped。
- `bun run typecheck`: 成功。
- `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk bun run test:desktop`: build・Rust・sidecar・desktop Vitest74件成功。
- E2Eは再実行していない。今回の製品変更は配布resourceとMSIX梱包・検証のみでUI挙動変更はないため、既存29件の成功記録を維持。

## Ghostwriterの自動refresh・更新後推論（2026-10-04 11:31 JST）

ユーザーの明示許可を受けた一度の自動フォローアップで実施。停止済みの検証processが存在しないことを確認後、専用登録を使って`bun /tmp/ghostwriter-siwc-auto-refresh.ts`を実行し、終了コード0。製品実装の変更はなし。

実時刻がaccess tokenの期限を過ぎた状態で、通常の`service.models`から`accountForRequest`→`refreshSelected`を通した。tokenや期限の書換え、force指定はしていない。更新後にstoreを読み直し、秘密値を出力せず変更の真偽だけを比較した。

- access token更新: true
- refresh token更新: true
- 保存済み期限の延長: true
- host/client登録の保持: true
- 更新後モデル一覧取得: true
- `gpt-5.6-luna`への短い接続検証でテキスト受信: true
- 推論ストリームを最後まで消費し、errorイベントなし、正常終端を検証する既存middlewareを通過、finishReason: stop

これは期限切れ後のリクエスト時に行う自動更新1回の実接続確認。期限直前の時刻ぴったりの起動、複数回連続の実ローテーション、実通信での競合・異常系は今回の保証に含めない。サインインを保持し、logoutは実行していない。配布版callback、Windows資格情報保護・実機、他provider live smoke、OSS公開条件の確認も引き続き229へ残す。

検証結果の記録だけなので新規テストは追加せず、実スクリプトの完了結果と文書差分・`git diff --check`で確認。全体test/typecheck/E2E/desktopは製品コード変更がないため再実行していない。

## チャット・AIアシストの主導線（230、2026-10-04）

設定と初回案内で「ChatGPTでログイン」を先頭の接続として提供。新規利用者のチャット・AIアシストはSIWC有効時にChatGPTプランを選び、認証済みの動的inventoryからモデルを取得する。既存の明示設定・会話bindingは優先し、接続エラーやモデル一覧の空・失敗でAPIキーへfallbackしない。接続を変更すると新規会話になる。AIアシストは独立した設定を保存し、承認後のUndoにも対応。

- 全体Vitest: 167ファイル、1481 passed / 2 skipped。型チェック成功。
- 全体Playwright: 30件成功。専用HTTPサーバーでOAuth/LLM境界を合成し、実runAgentLoop・ツール・会話保存・ファイルApply/UndoをUIから確認。設定→チャット→再読込・追質問→AIアシスト承認・Undo→接続切替・再読込を検証。
- ユーザーの明示承認後、独立preview・専用合成原稿・動的候補の`gpt-5.6-luna`で実LLM UI smokeも成功。設定のサインイン状態→チャットRead/Edit・自動Apply・Undo→再読込・接続/モデル保持・追質問→AIアシストの承認前不変・Apply・UndoをPlaywrightで操作し、実ディスクと更新後画面を確認。テスト原稿は原文へ復元。OAuth/LLMを合成したE2Eとは別の実接続結果であり、配布版実機の保証には含めない。
- desktop境界は未変更のためdesktop検証は再実行していない。配布callback、Windows資格情報保護、preview既定ON・公開は229のまま。

### ログイン操作の統一

ChatGPT接続設定の通常操作は状態に応じて1つとする。未登録・サインアウト時は「ChatGPTでログイン」、期限切れ・再認証必要・推論許可不足時は「もう一度ログイン」、有効なサインイン済み状態は「ログアウト」を表示する。ログイン時、選択中の登録があればaccountIdを指定して再利用し、登録のない初回のみ新規認証を開始する。

利用画面は単一のChatGPT接続を扱い、アカウント切替・追加・詳細設定を提供しない。別アカウントを利用する場合はlogout後にloginする。期限切れ等でも既存セッションのlogoutを通常の操作として利用できる。保存形式と既存登録は互換性のため維持する。処理中・loginPending時は認証変更操作を無効にし、ログイン待ちのキャンセルは利用可能にする。認証APIと会話bindingは変更しない。
