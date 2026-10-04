# Tauri WebViewでHTML5ファイルドロップを使う

## When this matters

Tauri v2デスクトップ版のReact画面で、`DataTransfer.files`を使ったOSファイルのdrag and dropを実装するとき。

## Field note

Tauriの既定ファイルドロップ処理が有効だと、WebViewのHTML5 `dragover` / `drop`へOSファイルが届かない。Webとデスクトップで同じ検証・挿入境界へ合流させる場合は、window設定の`dragDropEnabled`を`false`にしてWebView側のイベントを使う。

## Reliable procedure

1. `src-tauri/tauri.conf.json`の対象windowで`dragDropEnabled: false`を設定する。
2. React側で`dragover`と`drop`の両方を`preventDefault`し、`DataTransfer.files`だけをファイル入力として扱う。
3. ファイル内容は共通の件数、byte数、UTF-8、NULLバイト検証へ渡し、ブラウザのローカルfile URL遷移を防ぐ。
4. `scripts/tauri-security.test.ts`で設定を固定し、Web側のコンポーネントテストと`bun run test:desktop`を実行する。

## Failure signals

- Web開発版ではdropできるのにTauri版だけ何も起きない。
- Reactの`onDrop`が呼ばれず、Tauri固有drop eventだけが発火する。
- OSファイルを落とすとWebViewがfile URLへ遷移しようとする。

## Recheck when

Tauriのmajor version、window設定schema、またはファイルdropをTauri固有eventへ切り替えるとき。

## Related work

- task 178
