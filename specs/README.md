# 仕様索引

現行製品の仕様は以下を参照する。仕様変更時は該当文書を更新し、完了タスクや過去の検証記録だけに新しい要件を残さない。

| 文書 | 役割 |
| --- | --- |
| [製品仕様](novel-editor-mvp.md) | 画面、モード、編集、AI実行、保存、安全性の正本 |
| [SIWC直接接続](siwc-responses-migration.md) | ChatGPT接続、認証、資格情報、モデル・履歴、単一接続UI |
| [デスクトップ仕様](tauri-desktop-impact.md) | Tauri、sidecar、通信、配布target、MSIX |
| [ドロップテキストAPI](dropped-text-file-api-preflight.md) | チャット添付・ファイルimportの現行API/tool契約 |
| [開発ワークフロー](development-workflow.md) | 実装・テスト・レビュー・完了条件 |

## 仕様以外の資料

- [アーキテクチャ](../docs/architecture.md): 現行コードの責務と変更境界。
- [SIWC検証と公開状況](../docs/siwc-validation-status.md): 確認済み事項、保証範囲、公開前の残作業。
- [OSS公開前監査](../docs/oss-publication-audit.md): 公開対象の整理と個人情報・ローカルデータ除外。
- [アイディア](ideas.md): 未実装案。製品要件として扱わない。
- [過去の調査・計画](../docs/archive/README.md): 廃止機能や当時の判断。現行仕様ではない。

現在の挙動を調べる検索は`src/`と`specs/`を入口とし、設計理由が必要な場合に`docs/`や`agent-field-guide/`へ広げる。`docs/archive/`の未完了記述や旧APIは、そのまま現行要件として採用しない。OSS公開用の初回コミットには、移行元の完了タスク（`tasks/done/`）を含めない。現行仕様・検証状況・再利用可能な知見は、それぞれ`specs/`・`docs/`・`agent-field-guide/`を参照する。
