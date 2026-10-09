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

- [x] 違反を一時的に入れたときに検査が失敗することを確認した。
- [x] 現在のコードで検査が成功し、`bun run test`（または追加したscript）とCIに組み込まれている。
- [x] `docs/architecture.md`と`specs/development-workflow.md`のレビュー観点（vertical slice構成）に、検査の所在を追記した。
- [x] doneへ移動してcommitした。

## 作業記録

- 開始時に現行製品仕様・開発ワークフロー・対象タスクを確認し、難易度「低」が現在の範囲でも妥当と判断した。製品の動作は変更しない。
- 検査前のimport調査で、`llm`と`ai-chat`から`settings/settingsStorage.ts`へのユーザー設定参照が現在の依存図に明記されていないことを確認した。236で許容したユーザー設定参照と239で移した処理に合わせ、対象moduleだけの例外を文書・検査へ追記した。設定画面全体への逆依存は許可しない。構成変更は行っていない。
- 外部依存を増やさず、既存VitestとTypeScript compiler APIによる検査を`src/features/featureDependencies.test.ts`へ追加した。正規表現だけでimportを拾う方法より、コメント・文字列の誤検知を避け、型import、再export、動的importも同じ構文解析で扱えるため選択した。パスはTS設定に沿って解決し、解決できない相対参照も依存先を検査する。
- 保証する層は本番featureのソース依存。検出対象は許可表にないfeature参照、上位への逆依存、`ai-chat`と`ai-assist`の相互参照、新規featureの許可表への登録漏れ。テストと`test-support.ts`、feature外の参照元は対象外。`shared/server/apiRouter.ts`に本番feature参照があるため、任意追加の`shared`→feature禁止は導入しない。
- 検証方法を先に決め、一時的な`workspace/task237-dependency-probe.ts`で`workspace`→`ai-chat/ChatPane`の型import、再export、動的import、import型を追加した。対象検査が失敗し、4箇所すべてのファイル・行番号・参照先・許可先`(none)`を表示することを確認した。一時ファイルは削除し、恒久fixtureは追加していない。
- 許可表と文書を同時更新するルール、検査の所在・範囲をアーキテクチャと開発ワークフローへ追記した。既存の`bun run test`と`.github/workflows/desktop-preview.yml`のmacOS/Windowsテストstepへ自動的に含まれるため、package scriptやCI設定の追加は不要。
- 差分をレビューし、製品仕様の変更、不要な構成変更、追加依存がないことを確認した。Field Guideも検索したが、今回の知見は依存ルールとしてアーキテクチャ文書に反映済みで、独立した知見エントリーの追加は不要と判断した。

### 検証結果

- `bun run test src/features/featureDependencies.test.ts`: 現在のコードで成功。一時違反の導入時は意図した依存違反で失敗し、診断の内容も確認した。
- `bun run test`: 150ファイル成功、1ファイルskip。1214件成功、既存6件skip。初回sandbox内はローカルHTTPのlisten制限で既存8件が失敗したため、sandbox外で全体を再実行し成功した。
- `bun run typecheck`: 成功。
- `git diff --check`と差分・仕様の整合レビュー: 成功。
- Playwright、desktop、build、live LLM、手動画面操作は未実行。変更は依存検査と文書だけで、UI・製品実装・desktop・外部接続を変えていないため対象外。GitHub Actions上の実行は未実施で、既存workflowが全体Vitestを実行することを確認した。
