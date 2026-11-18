# SIWC検証と公開状況

SIWCのpreview既定値はOFF。Microsoft Store版での一般提供は2026-11-18時点で見送り。現行の動作は[SIWC仕様](../specs/siwc-responses-migration.md)に記載する。

## 確認済みの動作

| 範囲 | 根拠と保証 |
| --- | --- |
| macOSの独立登録と実推論 | 2026-10-04、設定UIの実OAuthとモデル一覧、application serviceと実ファイルを通したRead→提案→未保存拒否→Apply→Undo→追質問、AIアシスト、圧縮が成功 |
| macOSの実refresh | 期限切れ後の通常リクエストで自動refresh、access/refresh token置換・永続化、期限延長、更新後推論が成功 |
| Windowsの保存保護 | 実一時ファイルの本人限定ACL、置換後権限、reparse point/hardlink拒否、排他・失敗時保持を検証。POSIXの結果で代用していない |
| Windows配布版 | MSIX 1.0.6.0で実OAuth、AIアシスト提案→Apply→Undo、チャットRead、再起動復元・追質問、期限切れ後の自動refreshと更新後推論を確認 |
| logoutと再ログイン | Windows配布版で失効・session削除・登録保持、再認証後推論が成功。再起動なしの再試行でも成功 |
| 両OSの追加確認 | 2026-10-05にユーザーがSIWC追加後の変更をMac/Windowsとも確認済みと報告。最新versionでは未実施。報告にないビルド番号や個別手順は補完しない |
| 2026-10-05時点の設定UI | 既存登録で再ログイン、処理中の認証変更抑止、キャンセル、認証切れ時logoutを確認。当時は単一接続UI |
| 認証・編集の安全性 | ログイン重複防止、実行中logout拒否、refresh排他、秘密情報非露出、未保存拒否、競合・失敗時の非変更、二重適用防止・復元を既存自動テストで保証 |
| 旧CLI撤去 | UI・CLI/App Server/MCP・専用native経路は撤去済み。旧履歴読取りとApply/Undoは維持し、追加送信・圧縮・新規旧runtime作成を拒否 |
| 配布notice | Tauri resourcesとMSIX layoutへSIWC LICENSEを同梱し、欠落を検証で拒否。Windows生成物の元LICENSEとの一致も確認済み |

## 自動テストの到達点

2026-10-05の単一接続UIへの変更後、`bun run test`は147ファイル・1215件成功、既存2件skip。`bun run typecheck`と`bun run test:e2e -- e2e/siwc-settings.spec.ts --workers=1`（1件）も成功。設定E2EのOAuth/保存はAPIモック。

旧CLI撤去時の`bun run test:desktop`はweb build、Rust 14件、実sidecar smoke、desktop Vitest 75件が成功。その後のUIのみの修正ではnative境界を変えていないため再実行していない。

代表的な保証の所在:

- `src/features/siwc/SiwcSettingsSection.test.tsx`: 状態別操作、重複防止、既存登録再利用、キャンセル。
- `src/features/siwc/service.test.ts`と`refresh.test.ts`: runと認証変更の排他、refresh直列化・異常系、秘密情報非露出。HTTPは合成、保存・ACLは実ファイル。
- `src/features/ai-chat/siwcAgentChat.test.ts`、編集サービス・会話永続化テスト: 実ファイルRead、未保存拒否、Apply/Undo、履歴、失敗時の復元。
- `e2e/siwc-workflow.spec.ts`: 実HTTP・runAgentLoop・保存を通した画面連携。OAuth/LLMは合成。

## タスク248のWindows配布候補

2026-11-18の自動検証は、ロックファイルどおりの依存関係とNode.js 24で実施した。

- `bun run test -- --maxWorkers=2 --testTimeout=60000` は153ファイル、1258件成功、既存2件skip。設定の最終調整後にSIWC設定・接続のVitestを再実行して20件成功。`bun run typecheck` と `git diff --check` も成功。
- `bun run test:e2e -- e2e/siwc-settings.spec.ts e2e/siwc-workflow.spec.ts --workers=1 --trace=retain-on-failure` は2件成功。設定はAPIモックで、初回案内、サインアウト・再ログイン、利用状況リンクの新規タブを確認した。ワークフローは実HTTP・保存を通し、チャットとAIアシストでの表示と編集の適用・取り消しを確認した。OAuthとモデル応答は合成。
- 1.0.7への更新後に `bun run version:check` と `bun run test -- scripts/app-version.test.ts scripts/windows-msix.test.ts` を再実行し、バージョン整合と54件の成功を確認した。
- 利用状況リンクは既存のTauri openerを再利用したため、この変更では `bun run test:desktop` を実行していない。システムブラウザーで開く動作はWindows配布版で確認した。

`bun run build:desktop:windows` と `bun run package:windows:msix` でWindows x64の未署名MSIX `Ghostwriter_1.0.6.0_x64.msix` を生成し、`bun run validate:windows:msix` に成功した。候補のSHA-256は `F756738CA54F83F0735B47828E630CBD8CA3224B88BF427C254563939327CCF6`。ローカル環境には同じバージョンがインストール済みだったため、更新検証は1.0.7.0で行う。

ユーザーが1.0.7.0を生成・検証した後、既存のローカル検証用証明書で `Ghostwriter_1.0.7.0_x64-local.msix` に署名した。`signtool verify /pa` は成功し、`Get-AuthenticodeSignature` は `Valid`。署名済み候補のSHA-256は `60FFB344D3D39453BC301F3A66E6B35FE635729850EF78D19B26CF5F9DCEF03B`。ユーザーによる更新後、Windowsの登録バージョンが1.0.7.0であることを確認した。`GHOSTWRITER_ENABLE_SIWC_PREVIEW=1` を設定してパッケージ内の実行ファイルを起動し、設定画面にChatGPTプランと「Continue with ChatGPT」が表示された。

- ユーザーが既定ブラウザーで実アカウント認証を完了し、Ghostwriterに戻って初回案内が表示された。設定のサインイン済み状態と現在の登録表示を確認した。
- 検証用ワークスペースの新規チャットで、ChatGPTプラン利用中表示と、実リクエストに対する「接続確認OK」の応答を確認した。
- ユーザーがAIアシストの推敲、既定ブラウザーでの利用状況ページ、ログアウト後の再サインインと初回案内の再表示防止を確認した。
- 別登録への切替、許可不足からの再同意、上限到達等のエラー分岐は自動テストで確認した。これらの実サービス経路は今回の実機確認では未確認。

## タスク249のWindows配布候補

2026-11-18にWindows x64版1.0.8.0を生成し、MSIXレイアウト・runtime・ローカル検証用署名を確認した。1.0.7.0から更新後、SIWCプレビューを有効にして起動した。ユーザーはAIアシスト、左下の利用状況アイコンからのWebページ表示、ログアウトと再ログインの成功を報告した。固定モデル名のツールチップはPlaywrightで確認した。[タスク249](../tasks/done/249-move-chatgpt-chat-composer-notices.md)

## 既知事項と再検証の方針

再認証時に一度、接続失敗・busy継続が発生した。再起動で復旧し、その後は再起動なしでも成功。原因は未確定で、恒久修正済みとは扱わない。再ログインそのものは完了済みとし、原因調査を一律の必須残作業にはしない。再発状況と影響に応じて調査する。

実refreshの確認は通常操作に伴う期限切れ後の更新である。期限直前の厳密な時刻、複数回連続の実ローテーション、実サービス上での競合誘発まで確認したとは主張しない。

最新versionという理由だけで両OSの認証・保存をやり直さない。UIのみの変更は関連UIテストと配布画面確認、認証・保存・OS境界を変えた場合は影響する層の再検証を行う。SDK更新だけを理由とした全provider実接続smokeは公開の必須条件にしない。APIキーproviderは既存の自動テストと型チェックを基本とする。

## Microsoft Store更新の判定（2026-11-18、タスク229）

**見送り。** 1.0.8.0でプレビューのWindows実機確認は成功した。判定の対象は、ChatGPTプランを設定から一般利用できるWindows Store版の更新。1.0.8.0の未署名候補はMSIX検証に成功したが、環境変数を設定しない通常起動ではSIWCが無効になる。ChatGPT直接ログインを掲載する更新に、この候補は使えない。[Microsoft Store Policies 10.1](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#101-distinct-function-value-and-accurate-representation)

Ghostwriterは無料配布のローカルデスクトップアプリで、利用者の端末からOpenAIへ直接リクエストする。日本のStoreで無料と表示され、GitHub上のリポジトリが公開・MITであることを確認した。これはOpenAIが案内するオープンソース・ローカルアプリの枠に合うと判断する。公開ガイドに無料のローカルOSSをStore経由で配布する場合の追加申請は見当たらなかった。公開 `main` は確認時点で `de48e17` で、1.0.8.0の検証に用いた `5aa95fa` の変更は含まれていなかった。[Microsoft Store掲載ページ](https://apps.microsoft.com/detail/9NFPDWBQ7N82?hl=ja-JP&gl=JP)・[公開リポジトリ](https://github.com/nickmock3/ghostwriter-novel)・[OpenAIのOSS向け案内](https://developers.openai.com/siwc/token-sharing-open-source)

### 次の提出候補に必要な対応

1. **公開情報をそろえる。** 公開中のプライバシーポリシーと公式サイトには旧Codex接続が記載されている。SIWCで扱うアカウント情報とOAuth資格情報の保護、利用者の操作に伴う入力・履歴・参照原稿のOpenAIへの送信、ログアウトとアクセス解除を明記する。日本語Store掲載案に残るプロプライエタリのライセンス条項を、配布するバイナリの実際のライセンスに合わせる。配布候補に対応するソースを公開し、MSIXには既存のSIWC帰属表示に加えて本体のMITライセンス文を同梱する。[公開プライバシーポリシー](https://ghostwriter.mock-kobo.com/privacy)・[公式サイト](https://ghostwriter.mock-kobo.com/)・[Store掲載案](../store-assets/ja-jp/microsoft-store-listing-ja-JP.md)・[Microsoft Store Policies 10.5](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#105-personal-information)
2. **Windowsの保存保護を説明できる状態にする。** 現行のSIWCは、OAuthトークンと確認済みメールを本人限定ACLで保護したJSONに保存する。対象ファイル自体はアプリ側で暗号化していない。Microsoftの10.5.4への適合を示せるよう、Windowsのユーザー単位の暗号化などで保護し、既存の登録から移行できることを確認する。10.5.4への対応は公開準備上の判断で、Microsoftの個別審査結果ではない。[Microsoft Store Policies 10.5](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#105-personal-information)・[OpenAIの資格情報保護](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#credential-security)
3. **利用中と上限到達時の案内を確認する。** 左下の利用状況アイコンを維持し、入力枠外のモデル選択付近でもChatGPTプラン利用中と利用状況への導線が分かる形にする。上限到達時の既存リンクに加え、枠が利用できない間の再送抑止と、利用者が確認後に再開できる動作を確認する。APIキーへの自動切替を防ぐ既存の動作を維持する。[OpenAIのUIガイド](https://developers.openai.com/siwc/ui-ux-guidelines#show-when-the-chatgpt-plan-is-in-use)・[上限時の復旧](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
4. **通常起動の候補を作って再判定する。** Store版でSIWCを既定で使える構成にし、環境変数なしの通常起動と更新インストールで変更した境界を確認する。新しい未署名MSIXと掲載案を照合し、Partner Centerには対応プランが必要な機能の試験手順と、審査に必要なアクセス手段を用意する。提出・公開は再判定後に扱う。[Microsoft Store Policies 10.3](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies#103-product-is-testable)

## 記録の出所

2026-10-05までの実機結果はタスク227–233および229の記録とユーザー報告に基づく。実装の初期経緯は[過去の移植記録](archive/siwc-responses-migration.md)を参照。
