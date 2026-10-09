# hydrateRootの戻りは画面操作の準備完了を保証しない

## When this matters

SSRを使うReactアプリで、ルートのimportやcode splittingを変更した後、Playwrightの初回クリックが効かなくなるとき。

## Field note

`hydrateRoot()`はhydrationをスケジュールする。呼び出し直後にグローバルの完了フラグを立てると、SSRのボタンは表示されていてもReactの操作が準備できていないことがある。App経由のページ再exportをやめてルートからページを直接importした際、この待機の不備が再現した。ワークスペース選択のクリック後も未選択のままとなり、後続のファイルやチャット表示がtimeoutした。

同じ失敗5件は変更前のコミットで成功した。変更後は1 workerでも失敗し、Appのmount effectで完了フラグを立てる修正後に5件すべて成功した。並行実行の負荷だけを原因と判断せず、初回操作時の準備状態を確認する。

## Reliable procedure

1. error-contextで、操作後も初回画面のままか、APIエラーや画面例外が出ているかを区別する。
2. 初回クリックを待つフラグが、`hydrateRoot`の直後に立っていないか確認する。
3. シェルの操作を待つ場合は、シェルを組み立てるAppのmount effectで準備を通知する。遅延読み込みするページ内部の操作は、そのページの準備も別途確認する。
4. 失敗した既存テストと全体E2Eを再実行する。固定時間のsleepで操作を遅らせるだけでは保証しない。

## Failure signals

- 完了フラグを待ったのに、クリック後もワークスペースが未選択のまま。
- 画面遷移しようとすると初回モーダルのbackdropが操作を遮る。
- ルートimport変更前は成功し、変更後は並行度を落としても失敗する。

## Recheck when

React、TanStack Start、ルートのcode splitting、クライアントentry、hydration待機の仕組みを変更するとき。
