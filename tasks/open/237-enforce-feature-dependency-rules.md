# 237 feature間の依存ルールの自動検査

## 目的

236で整理したfeature間の依存の向きが再び崩れないよう、違反をテストまたはlintで自動検出する。

## 難易度

- 判定: 低
- 理由: 製品の挙動は変えず、検査の追加だけで完結する。判断が必要なのは検査手段の選択と許容ルールの表現に限られる。

## 前提

- `236-fix-reverse-feature-dependencies.md`が完了していること。
- 依存の向きは236で`docs/architecture.md`へ追記したものを正とする。

## 対象範囲

- 検査手段を選ぶ。候補は次のとおり。依存追加の要否と保守コストで判断し、選んだ理由を作業記録に残す。
  - 依存を増やさない方法: Vitestのテストで`src/features/**`の非テストファイルのimportを走査し、許可表にない`../<feature>/`の参照を失敗させる。
  - 外部ツール: `dependency-cruiser`など。循環検出まで任せられるが、devDependencyと設定ファイルが増える。
- 許可表は`docs/architecture.md`の依存の向きと対応させ、どちらかを変えるときにもう一方も更新するよう、検査コードかドキュメントに明記する。
- テストファイル（`*.test.ts(x)`）、`test-support.ts`、`src/test/`は検査対象から除外する。
- 違反時のメッセージで、違反したファイル、参照先、許可されている依存先がわかるようにする。

## 対象外

- `src/app/`、`src/routes/`、`src/shared/`からfeatureへの依存の制限（`src/shared/`→`features/`の禁止は、236完了時点で違反がなければ含めてよい）。
- 236で扱わなかった構成変更。

## 検証方針

- 検査が意図どおり失敗することを先に確認する。一時的に既知の逆向きimport（例: `workspace`から`ai-chat`）を追加して検査が失敗し、違反メッセージが期待どおりであることを確認してから、そのimportを戻す。この確認は作業記録に残し、恒久的なテストfixtureにはしない。
- Vitestで実装する場合は`bun run test`の対象に含め、CIで自動実行されるようにする。外部ツールの場合は`package.json`のscriptとCIの手順に追加する。

## 完了条件

- [ ] 違反を一時的に入れたときに検査が失敗することを確認した。
- [ ] 現在のコードで検査が成功し、`bun run test`（または追加したscript）とCIに組み込まれている。
- [ ] `docs/architecture.md`と`specs/development-workflow.md`のレビュー観点（vertical slice構成）に、検査の所在を追記した。
- [ ] doneへ移動してcommitした。
