# モジュール移動ではimportとワークスペースのパス文字列を分ける

## When this matters

featureやサブディレクトリ間で多くのTypeScriptファイルと隣接テストを移動し、相対参照を一括更新するとき。

## Field note

引用符内の`.`から始まる文字列をすべて相対moduleとして書き換えると、`path.posix.dirname`の結果と比較する`"."`まで`".."`へ変わる。型チェックと既存テストが成功しても、この変更を検出できない場合がある。また、ファイルを順番に移動しながら旧参照先の存在を確認すると、先に移動したmoduleへのimportを取りこぼす。

## Reliable procedure

1. 移動前に全ファイルの旧パス→新パスの対応と参照を収集する。書き換え対象はimport、export、dynamic import、テストのmock参照に限定する。
2. 旧moduleの解決は移動前の状態か固定した対応表を使い、移動途中のfilesystemへ依存しない。
3. 対応表を使って旧ファイルと新ファイルを比較し、module参照以外の差分もレビューする。`git diff`だけで新規ファイルが見えない段階は、移動先を明示的に読む。
4. 明示的なテストパス（VitestのNode/DOM分類など）と文書参照も更新する。

## Failure signals

- 型チェックで、移動順に依存した一部の旧importだけが見つからなくなる。
- ファイル移動だけのはずなのに、パス判定やfixtureの文字列まで変わっている。

## Recheck when

移動用スクリプトやcodemodを変更するとき。
