# WindowsのVolta Codex shimからnative executableを確認する

> 旧機能の履歴資料。タスク231でGhostwriterのCodex CLI連携を撤去したため、現行版の操作・実装には適用しない。

## When this matters

WindowsのWeb開発版でCodex CLI healthが`spawn EINVAL`または`invalid-installation`になり、`PATH`上では`codex.cmd`が先に見つかるとき。

## Field note

Voltaの`bin\codex.cmd`はnative binaryと同じディレクトリに置かれず、固定shimからVolta package image配下のplatform packageを起動する。`.cmd`を`spawn(..., { shell: false })`で直接起動するとWindowsでは同期的に`EINVAL`になり得る。同じディレクトリの`codex.exe`だけを探してもnative本体には到達しない。

## Reliable procedure

1. `codex.cmd`を実行せずテキストとして読み、改行と外側空白を正規化する。
2. 内容が`@echo off`と`volta run %~n0 %*`の固定2行に完全一致するときだけVolta shimとして扱う。
3. shimの`bin`親をVolta rootとし、`tools\image\packages\@openai\codex\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`をnative候補にする。
4. 解決先をそのまま信用せず、実行可能性、`codex --version`、App Server initializeを再検証する。
5. 任意のbatch内容、追加行、別package layoutは解釈せず、`shell: true`や`cmd.exe /c`へ渡さない。

## Failure signals

- health APIがraw `spawn EINVAL`を500で返す: version runnerの同期throwが候補失敗へ変換されていない。
- healthがsanitizedな`invalid-installation`になったまま: `.cmd`失敗後に同ディレクトリの`.exe`だけを探し、Volta package image内のnative本体へ解決できていない可能性がある。
- version probeは成功するがApp Serverが起動しない: probeで解決したnative pathではなく元のshimをmanagerへ渡していないか確認する。

## Recheck when

Voltaのshim形式、`@openai/codex`のnpm package layout、platform package名、またはCodex CLIのnative entrypointが変わったとき。

## Related work

- `src/features/codex-cli/codexCliInstallation.ts`
