# Vitestの環境準備と実I/Oの待ち時間を分けて調べる

## When this matters

Vitest全体が遅いとき、またはNode/DOM環境を分類し直すとき。

## Field note

テストファイルの行数や件数だけでは所要時間を推定できない。全体のjsdomを減らすと環境準備は軽くなるが、Windowsで実ACLを検証する資格情報ストアはPowerShellを何度も起動し、少数のテストファイルが全体時間を支配する場合がある。

テスト自身に`window`が現れなくても、呼び出し先が`window.location.origin`を使う`workspaceFilesClient`のような間接依存がある。分類後は全件の結果を確認する。

## Reliable procedure

- `bun run test --reporter=default --reporter=json --outputFile.json=<一時レポート>`で全体時間とファイルごとの時間を計測する。並列workerのenvironment/testsの合計は全体の経過時間ではない。
- `vitest.config.ts`でDOMが必要なテストだけをDOM projectに含め、Node側から同じリストを除外する。収集されたファイル・ケースが欠落も重複もしていないか照合する。
- 実I/Oケースを並行化する場合は、module scopeの可変ディレクトリとbeforeEach/afterEachを共有しない。test.extendのケース専用fixtureで生成・cleanupし、ケース内で比較する複数ストアには同じディレクトリを渡す。
- パラメータ化したfixture利用テストは`.for`の第2引数からcontextを受け取り、並行テストではcontextの`expect`を使う。実保存・ACL・排他のassertionを維持する。
- 対象単独の成功だけでなく、他のI/Oテストと競合する全体実行でも成功と速度を確認する。

## Failure signals

- Nodeへの移行後に`window is not defined`が出る場合は、対象と呼び出し先のブラウザ依存を確認する。
- 並行化後の`busy`、ファイル消失、別ケースの値の混入はfixture共有を疑う。isolation無効化や安全性テストのskipで隠さない。

## Recheck when

Vitestのproject/fixture APIを更新したとき、ブラウザAPI依存や資格情報保存の実装が変わったとき。参考: [Vitest test context](https://vitest.dev/guide/test-context)。
