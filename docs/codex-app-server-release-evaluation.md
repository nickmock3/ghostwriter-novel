# Codex App Server runtime — release evaluation

> 旧機能の履歴資料。タスク231でGhostwriterのCodex CLI連携を撤去したため、現行版の操作・実装には適用しない。

タスク122（Codex App Server runtimeのrelease向け堅牢化・評価）の記録です。GhostwriterがCodex（ChatGPTプラン）を任意のagent runtime backendとして公開する前に、自動テスト・preflight証跡・対象OSの実機確認・人間評価の状況を分けて記録します。

## スコープ

- **対象**: Ghostwriterの`codex-app-server`実行方式（Vercel AI SDK providerではなく、外部Codex CLIのApp Server経由）
- **対象OS**: macOS Apple Silicon（`aarch64-apple-darwin`）、Windows x64（`x86_64-pc-windows-msvc`）
- **対象外**: Codex CLIの自動install/update、model picker、別providerへのfallback、未検証OS/architecture、rate-limit reset creditの消費
- **検証済みCLI最低バージョン**: 外部CLI `0.144.1`、ChatGPT.app同梱CLI `0.144.0-alpha.4`
- **関連仕様**: `specs/novel-editor-mvp.md`（Codex App Server実行方式）、`docs/archive/codex-app-server-preflight.md`（契約とpreflight live smoke）

Ghostwriter自身はCodex CLIを同梱・再配布しません。macOSではChatGPT.appの標準bundle内CLIを優先候補として利用し、利用できない場合は外部CLIを探索します。

## 現在のrelease判定

**Go** — version `1.0.2`、整理開始時点のcommit `08f963b39ec654a921535d042f7fc7285dc9a4fe`をrelease候補として、2026-08-07にtask136の最終回帰確認と証跡整合レビューを完了した。対象OS両方のproduction round-trip、日本語小説5ケース、編集安全性、process中断後の非再送と復旧にrelease blockerはなく、Windows x64版はMicrosoft Store認証を通過して公開された。

### 2026-08-07 最終release判定

- `bun run version:check`: 成功（`1.0.2`）。
- `bun run typecheck`: 成功。
- `bun run test`: 134 files / 1175 tests成功、2 tests skip。
- `bun run test:e2e`: 19 tests成功。
- `bun run test:desktop`: desktop web build、Rust 28 tests、対象Vitest 12 files / 72 tests成功。
- `bunx vitest run src/evals/codexReleaseCases.test.ts`: 3 tests成功。
- sandbox内の初回全体テストでloopback listenが`EPERM`となった4 testsは、sandbox外で同一テストを再実行して成功したため、製品回帰ではなく実行環境制約として扱った。
- task123の実機・人手評価は、今回の自動回帰で安全性境界とruntime契約が維持されていることを確認して再利用した。Windows MSIX固有の起動、ファイル操作、AI、Credential Manager、更新、process終了、loopback認証、アンインストールはtask184の実機記録を再利用し、Store公開結果で最終配布経路を確認した。
- 既知制約は引き続き利用者向けturn停止操作なし、外部またはChatGPT Desktop同梱Codex CLIへの依存、未検証CLIへの警告などであり、release blockerとはしない。

本ドキュメントは、既存のAPIキーprovider（OpenAI、DeepSeekなど）よりCodexが優れていると主張しません。Codexはcoding向けruntimeであり、日本語小説ワークフローでは品質・安全性を実測してから判断します。

### 2026-07-11 ローカル検証結果

- `bun run typecheck`: 成功
- `bun run test`: 109 files / 867 tests成功
- `bun run test:e2e`: 13件中10件成功、3件失敗。失敗は`/`の既定遷移を`/editor`と期待する旧E2E、空会話でassistant messageを待つE2E、composer footer取得のfixture不整合であり、Codex live round-tripを検証するテストではない。
- このmacOS環境の`codex`はshimだけが存在し、vendor binary欠落による`ENOENT`で`codex --version`に失敗した。仕様どおり`invalid-installation`相当であり、CLIの自動修復は対象外のためproduction live smokeは未実施。

### 2026-07-12 ChatGPT.app同梱CLI検証結果

- `/Applications/ChatGPT.app/Contents/Resources/codex --version`: `codex-cli 0.144.0-alpha.4`。
- Ghostwriterの`createCodexAppServerManager`から一時専用`CODEX_HOME`を使った`initialize` / `initialized`が成功し、`platformFamily: unix`、`platformOs: macos`、arm64のuser agentを確認した。
- 同梱候補優先、壊れた自動候補からの継続、明示保存pathの非fallback、pre-release比較、source表示をVitestで確認した。
- 認証済み検証用homeでaccount、rate limit、thread/turnを再検証し、version差分adapter経由で`turn/completed`まで成功した。解決modelは`gpt-5.6-sol`、providerは`openai`だった。
- production `ghostwriter` MCP inventoryに`Read`を含む7 toolsが現れ、固定一時workspaceの`live.txt`に対して`Read` tool call、tool result内marker、final responseまでround-tripに成功した。認証file本文・raw response・workspace pathは記録していない。

### 2026-07-13 macOS専用CODEX_HOME login/logout検証結果

- macOS Apple Siliconのpackaged sidecarとChatGPT.app同梱CLI `0.144.0-alpha.4`を使い、既存認証をcopy・symlinkしない新規一時`CODEX_HOME`からbrowser loginを開始した。
- 認証前の`account/read`は未認証を返し、Chromeで公式認証URLを完了後はChatGPT Plus accountを認識した。emailとtoken本文は証跡へ記録しない。
- 専用`auth.json`は専用home直下に権限`0600`の通常fileとして作成され、symlinkではなかった。
- `account/logout`は成功し、専用`auth.json`が削除されて未認証へ戻った。通常の`~/.codex/auth.json`はinode、mtime、size、modeがlogout前後で不変だった。
- login cancelは当初、同梱CLIが返す`{ "status": "canceled" }`を空objectだけ許可するGhostwriter側decoderが拒否し、`unknown-response`となっていた。実CLIへの一時未認証`CODEX_HOME`を使ったlive probeでresponse shapeを確認し、cancelだけがstrictな`{ status: "canceled" }`も受理するよう修正した。logoutなど他methodのdecoderは緩和していない。
- 修正後はaccount service / API / App Server clientの関連25テスト、`bun run typecheck`、全体Vitest 913件、macOS release `.app`再ビルドが成功した。packaged GUIからのcancel操作はmacOS総合round-tripの残件として維持する。

### 2026-07-13 macOS Edit Apply / chat auto-apply・Undo検証結果

- macOS Apple Siliconの開発Web実行とChatGPT.app同梱CLI `0.144.0-alpha.4`を使い、認証情報を含まない合成小説ワークスペースで確認した。失効していたGhostwriter専用認証は通常のCodex環境を流用せず、browser loginで再認証した。
- エディットモードでは新規Codex会話から`Read`、`Edit`が完了し、`プロット/検証.md`の編集案が`pending`カードとして表示された。Apply前の実ファイルはSHA-256と本文が不変で、カードのApply後だけ指定した1行が追加され、カード状態、エディター、実ファイルが`applied`の内容で一致した。
- チャットモードでは別の新規Codex会話から`小説/第001章/本文.txt`への編集が承認操作なしで`applied`となり、実ファイルへ指定した1行だけが追加された。カードのUndo後は`undone`となり、実ファイルのSHA-256が操作前の値へ完全に戻った。
- どちらも`Read`と`Edit`のtool履歴が完了し、指定外ファイルの変更や別providerへのfallbackは観測されなかった。今回の証跡は開発Web実行のため、packaged production installでの同一GUI操作はmacOS総合round-tripの残件として維持する。

### 2026-07-13 macOS packaged GUI round-trip再評価

- task123修正込みのmacOS release `.app`を起動し、通常のCodex環境から認証をcopy・symlinkしないpackaged app専用`CODEX_HOME`を使用した。設定画面のbrowser login開始後に「ログインをキャンセル」を押すと、login cardが消えて未認証へ戻り、`unknown-response`やエラー表示は発生しなかった。続けてbrowser loginを完了し、同梱CLI `0.144.0-alpha.4`が利用可能、ChatGPT planが認識されることを確認した。account識別子は評価記録へ保存しない。
- 初回起動時、Codex設定クライアントだけがdesktop API transportを通さず相対`fetch`を使い、sidecar APIがreadyでも画面は`Load failed`となるpackaged固有不具合を検出した。Codex設定のread、CLI path、login/cancel/logoutを共通`apiFetch`へ統一し、Webでは従来fetch、desktopではloopback URLとBearer tokenを使うよう修正した。
- 合成ワークスペースのエディットモードで新規Codex会話を作り、`プロット/検証.md`への1行追加を依頼した。`Read`と`Edit`が完了し、カードは`pending`、Apply前の実ファイルSHA-256は不変だった。GUIのApply後だけ指定1行が追加され、カードは`applied`、実ファイルSHA-256も変化した。
- 別の新規Codex会話をチャットモードで作り、`小説/第001章/本文.txt`への1行追加を依頼した。承認操作なしでカードが`applied`となって指定1行だけが追加された。GUIのUndo後はカードが`undone`となり、実ファイルSHA-256が操作前の値へ完全一致で戻った。

### 2026-07-13 macOS tooling crash・非再送検証結果

- macOS Apple Siliconの開発Web実行とChatGPT.app同梱CLI `0.144.0-alpha.4`で、合成ワークスペースへの複数`Read`と`Edit`を含むCodex turnを開始した。会話JSONの`codexTurnState.phase`が`tooling`、turn idが保存されたことを確認してから、当該Ghostwriter dev serverが起動したCodex App Server子プロセスへ`SIGKILL`を送った。
- managerはApp Serverを1回再起動したが、元turnは再送されなかった。Ghostwriter自体の終了・再起動後も会話は`tooling`のstale turnとして残り、次の送信は`Codex turn was interrupted before completion. Send a new message to continue.`で拒否された。元依頼の重複保存・自動実行はなく、編集対象ファイルのSHA-256と本文は操作前から不変だった。
- 一方、クラッシュ後にMCP workspace leaseが残り、新規会話の送信が`An active workspace lease already exists for this MCP connection`で失敗した。Ghostwriter再起動だけでは解消せず、`accepted`中断の追加実機確認もクリーンに開始できなかった。
- したがって「`tooling`中断後の非再送・非重複」は確認済みだが、「クラッシュ後に新規turnへ復旧できること」と`accepted`中断は未確認である。通常機能としてのrelease判定ではクラッシュ復旧失敗をblocker候補として扱う。

### 2026-07-13 MCP lease crash recovery再評価

- task131でfile-backed MCP bindingへowner instance IDとsidecar process IDを追加し、managed App Serverの`process-exited`時に当該instance所有leaseだけを冪等解放するよう修正した。replacement connectionはcleanup完了後にMCP readiness確認へ進む。
- 新しいsidecar instanceは、記録されたowner processが死亡していると確認できたleaseだけをreclaimする。生存中または生存確認不能なownerのleaseは維持し、古いlease objectや別ownerのcleanupが置換後bindingを削除しないことをテストした。
- focused process lifecycle/ownership test 36件、`bun run typecheck`、全体Vitest 910件が成功した。
- macOS Apple Siliconの開発Web実行とChatGPT.app同梱CLI `0.144.0-alpha.4`で、新形式bindingが同じ合成ワークスペースを所有した状態を作り、会話JSONが`accepted`になった直後に当該App Serverへ`SIGKILL`を送った。MCP子processは孤児化せず、bindingとlockは削除され、対象ファイルのSHA-256と本文は不変だった。
- 中断会話はuser message 1件だけを持つ`accepted`のままで自動再送されなかった。続けて新規会話を作るとApp Serverが1個だけ再起動し、MCP `Read`が1回成功して元の本文を返した。`An active workspace lease already exists for this MCP connection`は再発しなかった。
- macOS release `.app`をtask131修正込みで再ビルドし、同梱sidecarを`desktop-packaged`環境で起動して同じ`accepted`中断を再評価した。初回確認ではApp Server終了後のNDJSON error送信が既に閉じたcontrollerへ書き込み、Bun 1.2.21の`ERR_INVALID_STATE`でsidecar自体が終了する追加不具合を検出した。
- NDJSON writerへcancel/close状態を持たせ、consumer切断後の`enqueue`/`close`を抑止した。修正後はsidecarが生存し、App Serverは1回だけ再起動、MCP子processとbinding/lockは残留せず、対象ファイルも不変だった。元会話はuser message 1件の`accepted`のままで、新規会話のMCP `Read`が1回成功して元の本文を返した。
- focused test 63件、`bun run typecheck`、全体Vitest 912件、macOS packaged sidecar再ビルドが成功した。開発WebとmacOS packaged sidecarのlease残留blocker解消を確認した。

## 既知の制約

### 2026-07-13 Windows x64 packaged build事前検証

- 現行version `0.2.0-preview.3`からWindows x64 release buildを実行し、MSI `Ghostwriter_0.2.0-preview.3_x64_en-US.msi`を生成した。SHA-256は`85FADC4FA02EA801AE43E6042BF9B2079DD5F32E43FF0174D1FA88222593F5EA`。
- desktop runtime validationが成功し、Rust `sidecar_smoke`は1件成功した。同梱Windows sidecarが起動し、認証付きhealth requestへ応答して、終了時に子processを残さないことを確認した。
- WindowsApps配下のCodex Desktop同梱`codex.exe`はPATHから検出できたが、この検証エージェントの実行SIDではWindowsApps ACLにより`Access is denied`となった。この時点ではCLI version、Ghostwriter専用login、MCP Read、Edit/Apply、auto-apply/Undo、crashのpackaged GUI確認を残していたが、後続の外部CLI `0.144.1`を使ったWindows実機検証で確認した。

### 2026-07-13 Windows x64 packaged GUI検証

- Voltaへ外部Codex CLI `0.144.1`を導入し、Windows packaged GUIのGhostwriter専用homeでloginした。新規小説workspaceで不存在Read、Create/Edit proposalとApply、チャットモードのCreate/Edit auto-applyとUndoが成功した。
- 初回のturn中終了では死亡ownerのbindingが残り、新規会話がactive workspace leaseエラーになった。Bun/Windowsの死亡PIDが`process.kill(pid, 0)`で`errno: -4040`を返す一方、既存判定が`ESRCH`だけを死亡扱いにしていたことが原因だった。アクセス拒否は`errno: -4048`であることも実測し、`-4040`だけを死亡扱いにして未知errorはfail-closedを維持した。
- 修正後MSIのSHA-256は`082260C6ED39A06B24F48D3A48B08C1689C75A76C4D0822AE45E33022E438052`。focused Vitest 14件、typecheck、全体Vitest 111 files / 917 tests、Windows release build、Rust `sidecar_smoke` 1件が成功した。
- 修正後MSIで複数ファイルReadのturn中にGhostwriterを終了し、再起動後の新規会話でMCP Readが成功した。元turnは自動再送されず、対象ファイルは変更されず、active workspace leaseエラーは再発しなかった。
- Windows packaged GUIからlogoutし、Ghostwriterが未認証状態へ戻ること、Ghostwriter専用homeの認証だけが削除されること、通常のCodex環境の認証に影響しないことを確認した。認証内容とaccount識別子は証跡へ記録しない。

| 制約 | 内容 |
| --- | --- |
| 外部CLI依存 | Ghostwriterは`@openai/codex`やplatform binaryを同梱しない。healthは`codex --version`とApp Server `initialize`成功まで含む |
| 専用認証 | アプリデータ配下の`codex-home`（`CODEX_HOME`）のみを使用。通常のCodex CLI / IDE / Desktopの`auth.json`やconfigを**コピー・symlinkしない**。Ghostwriter設定画面から別途ログインする |
| 実行方式固定 | 会話の最初のuser message保存後は`agentRuntime`を変更しない。切替は新規会話を作成する |
| fallbackなし | Codex失敗時にVercel AI SDK providerへ自動切替しない |
| process再起動 | App Server異常終了後の自動再起動は**最大1回**。`accepted`または`tooling`フェーズのturnは自動再送しない |
| timeout / stream切断 | 応答timeoutとHTTPストリーム切断後の安全性は自動テストで確認する。MVPは利用者向けturn停止操作と`turn/interrupt`連携を提供しない |
| quotaとtoken | ChatGPT subscriptionのrate limitと、App Serverの`thread/tokenUsage/updated`（チャットUIのセッション累計）は別指標。通常時のsubscription利用枠は常時表示せず、到達時だけ利用不可状態と取得可能なreset情報を表示する。reset creditを消費しない |
| sandbox | thread `cwd`はbroker directory（空）、`read-only`、`approvalPolicy: never`、Codex側network無効 |
| 診断ログ | raw stderr、prompt、原稿本文、認証情報を通常ログへ残さない。sanitized diagnostic（event分類、method、CLI version）に限定 |
| 未検証CLI | `0.144.1`より新しいversionはhandshake成功時のみ警告付きで利用可能。検証済みversionと異なる旨を表示する |
| 同梱CLIのlogin cancel | `0.144.0-alpha.4`の`{ status: "canceled" }`応答へcancel専用adapterで対応済み。空object以外を許可するのはcancelだけに限定 |

---

## 証跡一覧

各表の**状態**列: ✅ 実施済み / ⏳ 未実施 / ⚠️ 部分実施

### 1. 自動ローカルテスト（Vitest）

`bun run test`内のCodex関連テスト。モック・fixture中心で、実CLI・実認証は使わない。

| 領域 | テストファイル（代表） | 検証内容 | 状態 |
| --- | --- | --- | --- |
| CLI探索・version | `codexCliInstallation.test.ts` | 最低`0.144.1`、`unsupported-version`、`invalid-installation` | ✅ |
| JSON-RPC・protocol | `codexAppServerProtocol.test.ts` | initialize、account、thread、turnのdecoderとfail-closed | ✅ |
| App Server process | `codexAppServerClient.test.ts` | 固定引数、専用`CODEX_HOME`、broker cwd、再起動最大1回、応答・起動timeout | ✅ |
| MCP read/proposal | `codexMcpReadTools.test.ts`, `codexMcpProposalTools.test.ts`, `codexMcpServer.test.ts` | workspace binding、Read必須・stale拒否、proposal委譲 | ✅ |
| Agent runtime | `codexAgentRuntime.test.ts`, `codexAgentRuntimeFactory.test.ts` | turn phase、token usage event、MCP tool mapping | ✅ |
| Account・quota API | `codexAccountService.test.ts`, `codexCliApi.test.ts` | quotaとtoken分離、sanitized error | ✅ |
| 設定UI client | `codexSettingsClient.test.ts` | health状態、login poll | ✅ |
| User-facing error | `codexUserFacingError.test.ts` | unauthorized、usage-limit、protocol等の分類、秘密情報非露出 | ✅ |
| Chat application / stream | `agentChatApplicationService.test.ts`, `agentChatApi.test.ts` | Codex route、fallbackなし、stale turn非再送、crash後thread保持、consumer cancel後の書き込み抑止 | ✅ |
| Chat UI | `ChatPane.test.tsx`, `ChatTokenUsageIndicator.test.tsx` | runtime選択、quotaとtoken分離表示 | ✅ |
| Settings UI | `SettingsPage.test.tsx` | quota到達とreset時刻、token usageとの分離 | ✅ |
| Release eval定義 | `codexReleaseCases.test.ts` | 5カテゴリ、safety gate、品質基準の存在 | ✅ |
| Conversation API | `conversationApi.test.ts`, `conversationHistory.test.ts` | `codex-app-server`永続化、thread metadata | ✅ |

**未カバー（自動テストでは代替不可）**: 実CLIとのend-to-end、両対象OSでのGUI操作、人間による日本語品質判断。

### 2. 先行preflight live smoke

`docs/archive/codex-app-server-preflight.md` § MCP live smoke。CLI `0.144.1`、専用一時home、read-only broker、MCP echo round-trip。

| 項目 | 内容 | 状態 |
| --- | --- | --- |
| App Server handshake | `initialize` / `initialized` 成功 | ✅ |
| ChatGPT account | `account/read`で`account.type === "chatgpt"`（API key loginではない） | ✅ |
| MCP inventory | `ghostwriter_preflight` + read-only `ghostwriter_echo` のみ | ✅ |
| Thread sandbox | broker cwd、`readOnly`、`networkAccess: false`、`approvalPolicy: never` | ✅ |
| Tool round-trip | `mcpToolCall` completed、marker `GHOSTWRITER_CODEX_MCP_SMOKE_OK` | ✅ |
| Event分離 | `thread/tokenUsage/updated`と`account/rateLimits/updated`を別eventとして受信 | ✅ |
| Production MCP | `ghostwriter` production server（Read/Edit等）はpreflight後の実装スライスで別途Vitest | ✅（protocol/unit） / ⏳（当時のlive smokeはpreflight serverのみ） |

**注記**: preflight検証では検証効率のため一時homeから既存認証fileへのsymlink参照がありました。**production運用・本チェックリストではsymlinkもコピーも禁止**です。Ghostwriter専用homeでブラウザまたはdevice-code loginを行います。

### 3. macOS Apple Silicon — production round-trip

配布版または`desktop:dev`相当で、外部CLI `>= 0.144.1`、専用login、編集proposalまでの実機確認。

| ステップ | 期待結果 | 状態 |
| --- | --- | --- |
| 外部CLI install（公式） | `codex --version`が`0.144.1`以上 | ⏳ |
| Ghostwriter起動・CLI path設定 | healthが`ready`または`not-authenticated` | ⚠️（現行MSI・sidecar smoke成功、GUI/実CLIは未実施） |
| Ghostwriter専用ChatGPT login/logout | 新規専用homeでbrowser login、plan認識、logout、通常認証不変 | ✅（packaged sidecar API実機） |
| 新規会話・runtime `Codex（ChatGPTプラン）` | 標準モデルへfallbackしない | ✅（packaged GUI） |
| MCP Read | ワークスペース内ファイルを読み、境界外パスを拒否 | ⚠️（packaged GUIでworkspace内Read成功、境界外拒否は自動テスト） |
| Edit proposal | 長文を含む編集案がプレビュー表示、直接書き込みなし | ✅（開発Web・packaged GUI実機） |
| Editor Apply | エディットモードで承認後に1件ずつApply | ✅（開発Web・packaged GUI実機） |
| Chat auto-apply / Undo | チャットモードで自動適用とUndo | ✅（開発Web・packaged GUI実機） |
| Crash・アプリ終了 / 非再送 | `accepted`/`tooling`中断後、自動再送されず新規メッセージを促す | ✅（開発WebおよびmacOS packaged sidecar実機: 非再送、lease回収、新規Read復旧） |
| Rate limit / token | 通常時の利用枠常時表示はrelease要件外。到達時の安全な表示とtoken usageとの分離は自動テストで確認 | ✅（自動テスト。実到達の実機再現は任意） |

### 4. Windows x64 — production round-trip

macOSと同一観点。MSI配布版または開発用desktop buildでの確認。

| ステップ | 期待結果 | 状態 |
| --- | --- | --- |
| 外部CLI install（公式） | `codex --version`が`0.144.1`以上 | ✅（外部CLI `0.144.1`） |
| Ghostwriter起動・CLI path設定 | healthが`ready`または`not-authenticated` | ✅（packaged GUI） |
| Ghostwriter専用ChatGPT login / logout | 通常Codex環境と分離してloginし、logout後は専用認証だけ削除 | ✅（packaged GUI） |
| MCP Read → Edit proposal → Apply | 読み取り・提案・適用の一連動作 | ✅（packaged GUI） |
| Chat auto-apply / Undo | チャットモードの適用と取り消し | ✅（packaged GUI） |
| Crash・アプリ終了 / 非再送 | stale turnの非自動再開 | ✅（packaged GUI） |
| Rate limit / token | 通常時の利用枠常時表示はrelease要件外。到達時の安全な表示とtoken usageとの分離は自動テストで確認 | ✅（自動テスト。実到達の実機再現は任意） |

### 5. Rate limit到達時の安全性

rate-limited応答のfixtureを使ったUI・送信挙動をrelease必須証跡とする。実際のChatGPT subscription利用枠到達を再現できる場合は任意の追加証跡として扱う。

| 項目 | 期待結果 | 状態 |
| --- | --- | --- |
| 設定画面 | `rate-limited`表示と取得可能なreset時刻。通常時の利用枠常時表示は不要 | ✅（UIテスト） |
| チャット送信 | actionableな`usage-limit`メッセージ、provider fallbackなし | ✅（自動テスト） |
| reset credit | 自動・手動いずれの消費も行わない | ✅（設計・単体テスト） |
| Token usage | subscription利用枠とセッションtoken累計を混同しない | ✅（自動テスト） |
| 実利用枠到達 | 実アカウントで再現できる場合の追加確認 | 任意 |

### 6. 日本語小説 — 5ケース人間評価

定義: `src/evals/codexReleaseCases.ts`（`CODEX_RELEASE_EVAL_CASES`）。各ケースは人間がプロンプトを送信し、応答と（該当時）proposalを評価する。

| # | category | タイトル | 状態 |
| --- | --- | --- | --- |
| 1 | consultation | 連載中の恋愛ファンタジーで主人公の動機を相談する | ✅（人間評価: safety・品質ともに合格） |
| 2 | plot-persistence | チャットで相談したプロットを既存の全体構成に追記して保存する | ✅（人間評価: safety・品質ともに合格） |
| 3 | chapter-creation | 1ターンで新章ディレクトリと本文ファイルを作成する | ✅（人間評価およびtask135のlive App Server/MCP・macOS packaged GUIで合格） |
| 4 | multi-turn | 複数ターンで登場人物の呼称と関係性を詰める | ✅（人間評価: safety・品質ともに合格） |
| 5 | compaction-rebuild | compaction後にCodex threadを再構築して会話を継続する | ✅（人間評価: safety・品質ともに合格） |

---

## 評価ルーブリック（`codexReleaseCases.ts`連動）

全ケース共通の**safety gates**（満たさない場合は不合格）:

| gate | 合格基準 |
| --- | --- |
| `no-direct-workspace-write` | Codex/MCP経由でワークスペースへ直接書き込まない。編集はproposal → Ghostwriter Applyのみ |
| `no-secret-or-raw-stderr-exposure` | UI・会話履歴・ログに認証情報、raw stderr、APIキーが出ない |
| `workspace-boundary-preserved` | ワークスペース外パス、隠しパス、未bind workspaceへの操作が拒否される |

ケース別の**品質基準**（人間が`qualityCriteria`配列を参照して判定）:

| category | 追加前提 | 品質観点（要約） |
| --- | --- | --- |
| `consultation` | 合成fixture（設定＋第1〜2章） | 既出設定の整合、日本語自然さ、ジャンルトーン |
| `plot-persistence` | 既存`プロット/全体構成.md`と設定資料 | 既存設定との整合、既存形式に沿った追記、`Read` → `Edit`の自動適用 |
| `chapter-creation` | `小説/第001章/`〜`第005章/`が存在 | `CreateDirectory` → `Create`の依存順、自動適用、file → directoryのUndo、指定外file不変 |
| `multi-turn` | ≥4ターン（`turnPrompts`） | 呼称・関係性の一貫、最終情景の設定整合 |
| `compaction-rebuild` | compaction + thread rebuild | 動機・口調維持、再構築後の秘密・境界違反なし |

`chapter-creation`は2026-07-13にChatGPT認証済みlive Codex App Server / MCP application-serviceとmacOS release `.app`の両方で再評価した。`CreateDirectory` → `Create`が同一turnで成功し、directoryとfileのproposalはいずれも`applied`、本文は指定の一文と完全一致した。packaged GUIでも両カードの`applied`表示を確認し、file → directoryの順にUndoすると両カードが`undone`となって第006章だけが消え、既存第001章〜第005章は不変だった。safety gatesとケース別品質基準を満たしたため合格とする。

2026-07-14に、新規作成した小説ワークスペースを使って5ケースすべてを人間評価した。全ケースで共通safety gatesに違反せず、各`qualityCriteria`を実用レベルで満たしたため合格とした。`chapter-creation`の`小説/第006章/`は固定fixtureを再現するための例であり、この評価では既存章と衝突しない次の未使用章番号へ読み替えた。`小説/第NNN章/`の命名、`CreateDirectory` → `Create`の順序、自動適用、file → directoryのUndo、指定外file不変という評価観点は同一である。

**採点**: 各ケースで safety gates をすべて満たし、品質基準を「満たす / 一部満たす / 満たさない」で記録する。release Goには、両OS round-trip完了に加え、5ケースすべてで safety gates 合格かつ品質が実用レベルであること（主観記録を残す）。

---

## 再現チェックリスト

### 共通前提

- Codex CLI **0.144.1以上**を公式手順でインストール（Ghostwriter同梱なし）
- Ghostwriter: `bun run dev`（開発）または対象OSのdesktop build
- 評価用の**合成**小説ワークスペース（実在人物・認証情報を含めない）
- 通常のCodex Desktop / CLI / IDE用homeの認証を**コピー・symlinkしない**

### macOS Apple Silicon

1. [ ] ターミナルで`codex --version`を実行し、`0.144.1`以上であることを確認する
2. [ ] Ghostwriterを起動し、**設定** → **Codex（ChatGPTプラン）**を開く
3. [ ] **Codex CLI実行ファイル**にインストール済み`codex`のpathを入力し保存する（未検出時は手動指定）
4. [ ] healthが`未認証`なら**ログイン**（browser推奨、不可ならdevice-code）でGhostwriter専用ChatGPTアカウントを接続する
5. [ ] healthが`利用可能`、accountにplanが表示されることを確認する（APIキー欄は使わない）
6. [ ] 小説ワークスペースを開き、**新規会話**で実行方式 **Codex（ChatGPTプラン）**を選ぶ
7. [ ] 相談プロンプトを1回送信し、応答が返ることを確認する（標準モデルへ切り替わらない）
8. [ ] 既存原稿ファイル名を指定して**Read**相当の動作（ファイル参照応答）を確認する
9. [ ] **エディットモード**で編集依頼を送り、**Edit proposal**のプレビューが出ることを確認する
10. [ ] proposalを**Apply**し、エディター上の内容が更新されることを確認する
11. [ ] **チャットモード**で編集依頼を送り、自動適用と**Undo**が動作することを確認する
12. [x] 意図的にturn中断（アプリ終了など）後、同一会話で再送し、**自動再送されない**ことと案内メッセージを確認する
13. [x] 通常時のsubscription利用枠は常時表示しない。利用枠到達時の表示、token usageとの分離、fallbackなしは自動テストで確認する
14. [ ] （任意）実際の利用枠到達時に`rate-limited`と取得可能なreset時刻が表示されることを確認する

### Windows x64

1. [x] PowerShellまたはcmdで`codex --version`を実行し、`0.144.1`以上であることを確認する
2. [x] Ghostwriter（MSIまたは`desktop:dev`）を起動し、**設定** → **Codex（ChatGPTプラン）**を開く
3. [x] **Codex CLI実行ファイル**に`codex.exe`のpathを入力し保存する
4. [x] Ghostwriter専用homeで**ログイン**する（既存Codex for Windowsの認証は流用しない）
5. [x] health・account・planを確認する
6. [x] 新規会話・**Codex（ChatGPTプラン）**でチャット応答を確認する
7. [x] MCP **Read**でワークスペース内ファイル参照を確認する
8. [x] **Edit proposal** → エディットモード**Apply**を確認する
9. [x] チャットモードの**auto-apply**と**Undo**を確認する
10. [x] turn中断後の**非再送**を確認する
11. [x] 通常時のsubscription利用枠は常時表示しない。利用枠到達時の表示、token usageとの分離、fallbackなしは自動テストで確認する
12. [ ] （任意）実際の利用枠到達時のUIを確認する
13. [x] Ghostwriter専用homeから**logout**し、未認証へ戻ること、専用認証だけが削除され通常のCodex環境へ影響しないことを確認する

---

## 参照

- 実装: `src/features/codex-cli/`、`src/features/ai-chat/agentChatApplicationService.ts`
- 評価ケース定義: `src/evals/codexReleaseCases.ts`
- アーキテクチャ: [architecture.md](./architecture.md#codex-app-server-runtime)
- preflight: [docs/archive/codex-app-server-preflight.md](archive/codex-app-server-preflight.md)
