# 055 macOSとStore外Windows向けTauri auto updaterを追加する

## 背景

037の初回preview配布では、自動更新を含めず、Cloudflare R2上の新しいartifactを手動ダウンロードする運用にする。Tauri updaterは更新artifactの署名検証が必須であるため、署名配布の準備ができた後に導入する。Microsoft Store向けWindows MSIXの更新はStoreが配信するため、本タスクの対象には含めない。

## 依存

- 037
- 054

## 目的

- Tauri v2 updaterを導入し、R2上の静的update manifestから更新を確認できるようにする。
- macOS Apple SiliconとStore外Windows x64の署名済み更新artifactを生成する。
- 更新署名鍵をCI secretとして扱い、公開してよい検証鍵だけをアプリ設定へ含める。
- 更新確認、更新適用、更新失敗時のユーザー向け挙動を仕様化する。

## 完了条件

- macOS Apple SiliconとStore外Windows x64の署名済みupdate artifactが生成される。
- R2に配置するstatic update manifestのpath、format、cache方針、rollback方針がREADMEに記載される。
- アプリが起動時またはユーザー操作で更新確認できる。
- 更新がない場合、更新可能な場合、更新取得失敗、署名検証失敗のUI挙動が実装・テストされる。
- 更新署名鍵や署名パスワードがリポジトリ、ログ、artifactへ平文保存されない。
- `specs/novel-editor-mvp.md`、`docs/architecture.md`、READMEが最終構成と一致する。
- タスクファイルが`tasks/done/`へ移動され、関連変更がcommitされている。
