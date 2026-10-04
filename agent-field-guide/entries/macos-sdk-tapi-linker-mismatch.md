# macOS SDKのTAPI不整合はコマンド単位のSDK選択で切り分ける

## When this matters

TypeScriptの変更後、desktop検証がRustのlink時に`tapi error: malformed file`や`unknown architecture arm64e.x1`で失敗するとき。

## Field note

macOS 27.0 SDKのFramework `.tbd`をCommand Line Toolsのld-1267が読めず、desktop検証がsidecar smoke開始前に失敗した。インストール済みmacOS 26.5 SDKをコマンドのSDKROOTだけに指定すると、同じコードのdesktop検証が成功した。AI SDK更新の不具合とは別の環境条件だった。

## Reliable procedure

1. 失敗がWeb buildかRust linkか、実行時かを確認する。
2. `xcrun --find ld`、`clang --version`、インストール済みSDKを確認する。
3. 対応するSDKが既にある場合だけ、`SDKROOT=<そのSDKの絶対path> bun run test:desktop`で再検証する。
4. 検証記録にはSDKの変更を明記する。xcode-selectやグローバル設定を変更しない。

## Failure signals

Foundation/AppKitの`.tbd`解析で失敗し、sidecar smokeがまだ実行されていない。

## Recheck when

Command Line Tools、Xcode、macOS SDK、配布targetを更新したとき。別SDKでの成功を未検証の配布OSへ拡張しない。
