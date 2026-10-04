# Tauri MSIXのWindowsApps内sidecarを外部processへ直接再起動させない

## When this matters

TauriアプリをWindows MSIXとして配布し、次のようなprocess topologyを持つとき。

1. package identityを持つTauri本体がWindowsApps内の同梱sidecarを起動する。
2. sidecarがCodex CLI、language server、plugin hostなどpackage外のexecutableを起動する。
3. その外部processへ、WindowsApps内sidecarのpathをworker、MCP server、callback hostなどの再起動commandとして渡す。

Tauriと最初のsidecarは動くのに、外部processから起動するworkerだけが見つからない、認識されない、または`Access is denied`になる場合に参照する。

## Field note

TauriがMSIX package内のsidecarを起動できたことは、そのsidecarが起動したpackage外processもWindowsApps内の同じEXEを起動できる、という証明にはならない。package identityを持つ起動元と、通常の外部processではWindowsAppsに対する実行境界が異なり得る。

したがって、Windows packaged runtimeで`process.execPath`や同梱resourceの絶対pathを外部processへ渡し、同じbinaryを子processとして再起動させる設計は実機確認なしに採用しない。fileが存在し、読み取り可能で、Tauriから一度起動済みでも、外部processからの実行可能性は別に検証する。

この問題はCodex固有ではない。Tauri sidecarがさらに外部runtimeを起動し、そのruntimeがpackage内EXEをplugin host、stdio server、language server、workerとして起動し直す構成全般に適用できる。

Ghostwriterでは、Tauriが同梱sidecarを起動し、sidecarが外部Codex CLIを起動した後、Codexへ`WindowsApps\...\ghostwriter-sidecar.exe --mcp-server`を渡していた。外部Codexからの起動だけが`Access is denied`となり、同一binaryをpackage外へcopyするとMCP serverと全toolが正常に認識された。

## Reliable procedure

1. process topologyを図または親子一覧にし、どのprocessがpackage identityを持ち、どのprocessがpackage外かを区別する。
2. 「Tauri → package内sidecar」と「package外process → package内sidecar」を別々に起動確認する。前者の成功を後者の証拠にしない。
3. package外processからWindowsApps内EXEを最小引数で直接起動し、exit、`Access is denied`、標準入出力handshakeの有無を確認する。
4. 同じEXEを一時的にpackage外の安全なdirectoryへcopyし、sourceとcopyのbyte数とSHA256が一致することを確認してから同じ起動試験を行う。
5. WindowsApps内だけ失敗し、hashが同じpackage外copyは成功するなら、binary内容やprotocolではなくpackage実行境界が原因である。
6. productionではWindowsApps内pathを外部processの再起動commandへ直接渡さない。検証済みhostをpackage外へ安全にprovisionするか、認証付きloopback transportなど外部child executableを必要としない構成にする。
7. package外へexecutableを配置する場合は、信頼済みpackage sourceへの限定、version/hash別配置、source/target hash検証、同一directory内の一時fileとatomic rename、通常file・reparse point確認、並行展開、Windows file lock、Store配布要件を設計に含める。user-writableな既存targetを検証せず再利用しない。
8. Tauriが展開を担当しても、外部processへcommandを渡すsidecar側でpath形状、通常file、symlink、path内hashと実fileのSHA-256を実行直前に再検証する。これによりTauri展開後から外部process起動までの改ざん窓を狭める。
9. WindowsApps ACL変更、所有権取得、管理者実行、`shell: true`、`cmd.exe /c`をproduction回避策にしない。
10. 診断用copyは検証後に削除し、workspaceやリポジトリへ残さない。

## Failure signals

- Tauri本体、同梱sidecar、外部processの順に起動ログがあるのに、外部processが開始するpackage内workerだけが起動しない。
- WindowsApps内EXEは存在しhashも正しいが、package外processからの直接起動だけが`Access is denied`になる。
- 同一hashのpackage外copyは同じ引数とprotocolで正常に動く。
- `process.execPath`が既存fileを指すことだけを根拠に、外部processへ再起動commandとして渡している。
- 上位機能の接続失敗として丸められ、実際のworker起動段階へ到達していない。GhostwriterではMCP失敗がモデル一覧の`connect / unknown`として現れた。
- 上位機能だけreadiness確認から外して見かけ上直すが、workerを必要とする本機能は動かないままになる。

## Recheck when

Tauri、MSIX packaging方式、WindowsAppsのprocess実行規則、sidecar配置、外部runtimeのplugin/worker transport、Bun compile executableの`process.execPath`、Microsoft Storeのpackage外code実行要件を変更するとき。

## Related work

- `tasks/open/194-run-codex-mcp-host-outside-windowsapps.md`
- `src/features/codex-cli/codexAppServerClient.ts`
- `src/features/codex-cli/codexAgentRuntimeFactory.ts`
- `src-tauri/src/sidecar.rs`
