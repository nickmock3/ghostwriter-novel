# Agent Field Guide Index

作業開始時にこの索引を確認し、現在の作業に関係するエントリーだけを読んでください。新しいエントリーを追加した場合は、この索引にも1行追加します。

## Entries

- [モジュール移動ではimportとワークスペースのパス文字列を分ける](entries/module-moves-preserve-path-literals.md): 多数のファイル移動で相対参照を一括更新するとき。

- [空の.env.local雛形は移行した.envを上書きする](entries/local-env-template-shadowing.md): 初期セットアップ後に既存環境変数を移行するとき。

| Area | When this matters | Field note | Entry |
| --- | --- | --- | --- |
| Testing / performance | Vitest全体の遅延やNode/DOM分類を調べるとき | jsdom準備と実ACLの待ち時間を別計測し、I/O並行化ではケース専用fixtureを使う | [Vitestの環境準備と実I/Oの待ち時間を分けて調べる](entries/vitest-environment-and-io-cost.md) |
| Agent workflow | Codex使用枠に余裕があり、独立した高判断タスクを並行実装するとき | 子が方針を固め、低コストな孫へ限定調査や局所実装を委任し、メインが統合する | [Codex使用枠に余裕がある場合のツリー型multi-agent実装](codex-multi-agent-tree-workflow.md) |
| Workspace / dependency | file-treeやworkspaceがai-agentのキャッシュ無効化を直接呼びそうなとき | 変更通知はworkspaceの薄いnotifier、ai-agentが購読する | [ワークスペース変更通知でai-agentへの逆依存を切る](workspace-changed-notifier-decouples-ai-agent.md) |
| GitHub Actions | 手動実行inputでplatform別buildを選択するとき | job-level `if`でmatrixを参照せず、targetごとのjobをinputでgateする | [GitHub Actionsで選択可能なビルドを分ける](github-actions-selectable-build-jobs.md) |
| Desktop / drag and drop | Tauri WebViewでOSファイルをHTML5 dropとして扱うとき | `dragDropEnabled: false`でWebViewイベントへ合流させる | [Tauri WebViewでHTML5ファイルドロップを使う](tauri-html5-file-drop.md) |
| Windows / MSIX | Windows x64 MSIXをStore提出またはローカル検証するとき | Store用未署名MSIXとsideload用署名コピーを分け、信頼ストア・Partner Centerのsubmission状態を確認する | [Windows MSIXのStore提出とローカルsideload](windows-msix-build-and-sideload.md) |
| Windows / Codex CLI | Web devで`codex.cmd`が先に見つかりhealthが`spawn EINVAL`または`invalid-installation`になるとき | Volta shimは実行せず固定内容だけを認識し、package image内のnative `codex.exe`を再検証する | [WindowsのVolta Codex shimからnative executableを確認する](entries/windows-volta-codex-shim.md) |
| Tauri / Windows MSIX | Tauriは同梱sidecarを起動できるのに、その先の外部processから同じEXEを起動できないとき | package内processの起動成功は、package外childによるWindowsApps内EXEの再起動可能性を保証しない。同一binaryをpackage外へ置く対照実験で切り分ける | [Tauri MSIXのWindowsApps内sidecarを外部processへ直接再起動させない](entries/windows-msix-tauri-sidecar-external-process-boundary.md) |
| Desktop / Codex diagnostics | Web版とpackaged desktop版でCodexの結果が異なるとき | dataRootの容量制限付きJSONLへ段階と分類だけを記録し、MSIXではPFN配下から探索する | [packaged desktopのCodex失敗をサニタイズ済みJSONLで切り分ける](entries/codex-packaged-diagnostic-log.md) |
| Testing / Playwright | APIモックを外して保存・編集案の永続化を確認するとき | 一時dataRootの専用サーバーとrealpath済みworkspaceを使い、保存表示とディスク本文を別々に確認する | [実ファイルE2Eでは保存領域と復元キーのrootを揃える](entries/real-filesystem-e2e-isolation.md) |
| Chat / persistence | 自動Applyの保存順序やproposal IDを変更するとき | tool実行中の先行保存と別processのMCPを追い、保存済みIDをaccumulatorで維持する | [チャット自動Applyはターン終了より前に別プロセスでも実行される](entries/chat-auto-apply-persistence-boundaries.md) |
| OpenAI / model catalog | 新しいOpenAI API model IDを候補へ追加するとき | SDKが文字列IDを受けてもreasoning判定や送信パラメータが合うとは限らない | [新しいOpenAIモデルはAI SDKのID判定を確認する](entries/openai-new-model-sdk-capabilities.md) |
| DeepSeek / model catalog | 新しいDeepSeek API model IDを候補へ追加するとき | SDKのthinking履歴判定が旧IDだけに対応している場合がある | [DeepSeekの新IDではSDKのthinking履歴判定を確認する](entries/deepseek-model-id-sdk-recognition.md) |
| Chat / route lifetime | バックグラウンド実行や選択文引き渡しを変更するとき | 通信と画面の寿命を分け、処理済み追加要求IDもセッションへ保持する | [チャットの状態と画面の寿命を分ける](entries/chat-session-view-lifetime.md) |
| Chat / reasoning | 推論途中経過やCodex通知変換を変更するとき | 要約のopt-inと実際の受信を分け、turn/start応答より先の通知はターン照合を待つ | [推論表示は公開要約の受信とターン識別を分けて確認する](entries/chat-reasoning-stream-boundaries.md) |
| AI / stream termination | 長文や複数章の生成が途中で止まるとき | fullStreamのerrorイベント、ステップ上限、本文生成の完了待ちを別々に確認する | [AI生成の停止はストリームイベントと実行ステップを分けて調べる](entries/ai-stream-stop-diagnosis.md) |
| SIWC / SDK migration | SDK更新やSIWC検証コードを移植するとき | SDK 7のresponse.messagesは最終stepのみ。全履歴と正常終端はHTTP/SSE境界で検証する | [SIWC移植時はSDKの全ステップ履歴と正常終端を分けて確認する](entries/siwc-sdk-step-history.md) |
| macOS / desktop test | Frameworkのtbdでunknown architectureやTAPI errorが出るとき | インストール済みSDKをコマンド単位のSDKROOTで切り替え、link不整合とアプリ不具合を分ける | [macOS SDKのTAPI不整合はコマンド単位のSDK選択で切り分ける](entries/macos-sdk-tapi-linker-mismatch.md) |
| SIWC / workspace | 同じBunアプリがtokenを保存し任意の原稿rootを読めるとき | ファイル権限だけでは同プロセスのReadを防げない。private保存領域とのroot重複を入口で拒否する | [アプリ内token保存はワークスペースのRead境界も保護する](entries/siwc-private-workspace-boundary.md) |
| SIWC / Windows | Windowsへ本人限定の資格情報保存を追加するとき | 作成時ACL・子fileの権限・reparse pointを実ファイルで確認し、POSIX modeやdirectory fsyncに依存しない | [Windowsの資格情報保存では作成時ACLと子PowerShellの実環境を確認する](entries/windows-siwc-permissions.md) |
| AI / connection defaults | 新規利用者の接続既定値を変えるとき | 自動保存前に既存設定を識別し、接続選択と候補取得を分離する | [接続の既定値変更では自動保存前の明示設定を識別する](entries/connection-default-migration.md) |

- [Viteを使うE2E検証中はReact contextのソース編集を止める](entries/playwright-vite-hmr-context.md): 検証と整形を並行した後、provider欠落エラーで画面操作がtimeoutするとき。

- [hydrateRootの戻りは画面操作の準備完了を保証しない](entries/react-hydration-readiness.md): ルートimport変更後に、完了フラグを待っても初回クリックが効かなくなるとき。

- [SPAシェルはlocalStorageなしの初期stateとpending表示で描画される](entries/spa-shell-initial-state-and-pending.md): 再読み込み直後に初回モーダルや空白画面が一瞬見えるとき。

- [ペイン専用ボタンのCSSは共通buttonルールの詳細度を確認する](entries/shared-button-css-specificity.md): 補助ボタンや無効状態のCSSが部分的にしか効かないとき。
