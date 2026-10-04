# 054 macOS notarizationとStore外Windows code signingを追加する

## 背景

037では費用を抑えるため、Cloudflare R2上で未署名preview artifactを限定配布する。広い利用者へStore外で配布する段階では、macOS Gatekeeper警告やWindows SmartScreen警告を減らし、配布物の出所を検証できるようにする必要がある。Microsoft Store向けWindows MSIXはPartner Centerで署名されるため、本タスクのWindows code signing対象には含めない。

## 依存

- 037

## 目的

- macOS Apple Silicon向けartifactへDeveloper ID署名とnotarizationを適用できるようにする。
- Store外で配布するWindows x64向けinstallerへcode signingを適用できるようにする。
- 証明書、秘密鍵、notarization credential、署名パスワードをCI secretとして扱い、リポジトリやartifactへ平文保存しない。
- 署名なしpreview artifactと署名済みrelease artifactの手順を分ける。

## 完了条件

- macOS Apple Silicon向けapp bundleまたは配布用archiveが署名され、notarizationを通過する。
- Store外で配布するWindows x64向けinstallerが署名される。
- 署名に必要なCI secret名、ローカル検証手順、失敗時の調査手順がREADMEに記載される。
- 未署名preview配布と署名済みrelease配布の違いがREADMEに記載される。
- 証明書secretや秘密鍵本文がリポジトリ、ログ、artifactへ平文保存されない。
- `specs/novel-editor-mvp.md`、`docs/architecture.md`、READMEが最終構成と一致する。
- タスクファイルが`tasks/done/`へ移動され、関連変更がcommitされている。
