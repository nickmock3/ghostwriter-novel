# SIWC検証と公開状況

2026-10-05時点。SIWCは実装・主要検証済みで、preview既定OFFを維持している。公開用の別リポジトリへの移行と公開判断は未完了。本書は現在の確認結果と残作業をまとめ、[SIWC仕様](../specs/siwc-responses-migration.md)から検証履歴を分離する。

## 確認済みの動作

| 範囲 | 根拠と保証 |
| --- | --- |
| macOSの独立登録と実推論 | 2026-10-04、設定UIの実OAuthとモデル一覧、application serviceと実ファイルを通したRead→提案→未保存拒否→Apply→Undo→追質問、AIアシスト、圧縮が成功 |
| macOSの実refresh | 期限切れ後の通常リクエストで自動refresh、access/refresh token置換・永続化、期限延長、更新後推論が成功 |
| Windowsの保存保護 | 実一時ファイルの本人限定ACL、置換後権限、reparse point/hardlink拒否、排他・失敗時保持を検証。POSIXの結果で代用していない |
| Windows配布版 | MSIX 1.0.6.0で実OAuth、AIアシスト提案→Apply→Undo、チャットRead、再起動復元・追質問、期限切れ後の自動refreshと更新後推論を確認 |
| logoutと再ログイン | Windows配布版で失効・session削除・登録保持、再認証後推論が成功。再起動なしの再試行でも成功 |
| 両OSの追加確認 | 2026-10-05にユーザーがSIWC追加後の変更をMac/Windowsとも確認済みと報告。最新versionでは未実施。報告にないビルド番号や個別手順は補完しない |
| 単一接続UI | 追加・切替・詳細設定を削除。既存登録で再ログイン、処理中の認証変更抑止、キャンセル、認証切れ時logoutを確認 |
| 認証・編集の安全性 | ログイン重複防止、実行中logout拒否、refresh排他、秘密情報非露出、未保存拒否、競合・失敗時の非変更、二重適用防止・復元を既存自動テストで保証 |
| 旧CLI撤去 | UI・CLI/App Server/MCP・専用native経路は撤去済み。旧履歴読取りとApply/Undoは維持し、追加送信・圧縮・新規旧runtime作成を拒否 |
| 配布notice | Tauri resourcesとMSIX layoutへSIWC LICENSEを同梱し、欠落を検証で拒否。Windows生成物の元LICENSEとの一致も確認済み |

## 自動テストの到達点

単一接続UI削除後の`bun run test`は147ファイル・1215件成功、既存2件skip。`bun run typecheck`と`bun run test:e2e -- e2e/siwc-settings.spec.ts --workers=1`（1件）も成功。設定E2EのOAuth/保存はAPIモックであり、実認証の証拠とは区別する。

旧CLI撤去時の`bun run test:desktop`はweb build、Rust 14件、実sidecar smoke、desktop Vitest 75件が成功。その後のUIのみの修正ではnative境界を変えていないため再実行していない。

代表的な保証の所在:

- `src/features/siwc/SiwcSettingsSection.test.tsx`: 状態別操作、重複防止、既存登録再利用、キャンセル。
- `src/features/siwc/service.test.ts`と`refresh.test.ts`: runと認証変更の排他、refresh直列化・異常系、秘密情報非露出。HTTPは合成、保存・ACLは実ファイル。
- `src/features/ai-chat/siwcAgentChat.test.ts`、編集サービス・会話永続化テスト: 実ファイルRead、未保存拒否、Apply/Undo、履歴、失敗時の復元。
- `e2e/siwc-workflow.spec.ts`: 実HTTP・runAgentLoop・保存を通した画面連携。OAuth/LLMは合成。

## 既知事項と再検証の方針

再認証時に一度、接続失敗・busy継続が発生した。再起動で復旧し、その後は再起動なしでも成功。原因は未確定で、恒久修正済みとは扱わない。再ログインそのものは完了済みとし、原因調査を一律の必須残作業にはしない。再発状況と影響に応じて調査する。

実refreshの確認は通常操作に伴う期限切れ後の更新である。期限直前の厳密な時刻、複数回連続の実ローテーション、実サービス上での競合誘発まで確認したとは主張しない。

最新versionという理由だけで両OSの認証・保存をやり直さない。UIのみの変更は関連UIテストと配布画面確認、認証・保存・OS境界を変えた場合は影響する層の再検証を行う。SDK更新だけを理由とした全provider実接続smokeは公開の必須条件にしない。APIキーproviderは既存の自動テストと型チェックを基本とする。

## 公開前に残る作業

1. 最新のログインUIを次の配布ビルドへ反映し、設定画面の表示を確認する。
2. 旧履歴を持ち越さず、コード・仕様・テストを別repoへ移す。個人パス除去とignore補強は完了済み。公開者名・Store識別子・ライセンスは保持する。移行先の内容・初回commit作者情報を[監査手順](oss-publication-audit.md)に沿って確認する。
3. Ghostwriterの公開・配布形態に対するSIWC提供条件の適合、利用案内、公開判断を完了する。OSS化だけで適合確認が済んだとは扱わない。
4. 上記完了後にタスク229をdoneへ移し、関連変更をcommitする。現時点では公開・preview既定ONへの変更はしていない。

## 記録の出所

本書はタスク227–233および229の実装・検証記録と2026-10-05のユーザー報告を整理したもの。今回新しく実OAuthや実機検証を行った記録ではない。詳細な初期経緯は[過去の移植記録](archive/siwc-responses-migration.md)へ保存し、現在の結果を参照するために完了タスクを読む必要がない形とした。
