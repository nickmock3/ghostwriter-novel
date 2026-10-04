# 実ファイルE2Eでは保存領域と復元キーのrootを揃える

## When this matters

PlaywrightでAPIモックを外し、ファイル保存や会話・編集案の永続化を確認するとき。

## Field note

原稿の一時ワークスペースだけでは隔離が足りない。会話・編集案などはサーバーのdataRootへ保存されるため、E2E用Viteにも一時的な`GHOSTWRITER_DATA_DIR`が必要になる。既存dev serverを再利用すると、そのサーバーの保存先を使ってしまう。

また、workspace APIはrootを正規化する。macOSの一時ディレクトリにはsymlink経由の表記があり、未正規化rootでlocalStorageの開始ガイド非表示キーを作ると、APIが返すrootを含むキーと一致しない。fixture作成後の`realpath`でrootを揃えると、ガイドを「表示されるかもしれない」として例外を握りつぶす必要がなくなる。

## Reliable procedure

1. `e2e/support/start-server.ts`で一時dataRootを持つ専用サーバーを起動する。既存サーバーは再利用しない。
2. テストごとに一時workspaceを作り、`realpath`したrootをAPI入力とlocalStorageの復元キーへ渡す。
3. サーバーを終了してからdataRootを削除する。workspaceもテスト終了時に削除する。
4. 保存結果は画面のSaved表示に加え、ディスク本文と実APIの再取得で確認する。

保存APIを一時的に「成功応答だけで書き込まない」処理へ置き換えた確認では、画面はSavedになったが、ディスク本文のassertionは変更前の本文を検出して失敗した。UIの成功表示と永続化の保証は独立して確認できる。

## Failure signals

- テスト用workspaceを使っているのに、通常のアプリデータに会話が残る。
- 非表示にしたはずの開始ガイドが出て、後続のクリックを遮る。
- 保存成功表示だけでテストが通り、ディスク本文は変わっていない。

## Recheck when

workspace rootの正規化、開始ガイドの永続キー、dataRoot解決、PlaywrightのwebServer起動方法を変えるとき。
