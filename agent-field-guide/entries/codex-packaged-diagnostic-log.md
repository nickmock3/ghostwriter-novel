# packaged desktopのCodex失敗をサニタイズ済みJSONLで切り分ける

> 旧機能の履歴資料。タスク231でGhostwriterのCodex CLI連携を撤去したため、現行版の操作・実装には適用しない。

## When this matters

Web開発版ではCodexが動く一方、MSIXやmacOS packaged desktopだけでCLI health、account、モデル一覧、App Server runtimeが失敗するとき。

## Field note

packaged sidecarのstderrは通常のGUI起動から取得しづらく、APIの公開エラーも意図的に丸められている。`dataRoot/logs/codex-diagnostics.jsonl`へ、CLI health、App Server lifecycle、account確認、`model/list` page decode、inventory validation、API結果の段階と分類だけを記録すると、raw protocolや秘密情報を保存せずにWeb版との差を比較できる。

ログeventは固定unionとruntime allowlistの両方で制限する。raw response、stdout/stderr、例外message/stack、email、token、prompt、原稿、model詳細、ローカル絶対pathをeventへ渡さない。observerとファイルI/Oはfail-safeにし、本来のCodex処理を失敗させない。ファイルは容量制限し、Windowsで既存backupがある場合も置換して1世代だけローテーションする。

MSIXの物理data pathはpackage redirectionへ依存する。`%LOCALAPPDATA%\Packages\<PFN>`以下を`codex-diagnostics.jsonl*`で再帰探索し、固定した`LocalCache`等の中間pathへ依存しない。

## Related work

- `docs/codex-diagnostic-log.md`
- `src/features/codex-cli/codexDiagnosticLog.ts`
- `src/features/codex-cli/codexModelInventory.ts`
- `src/features/codex-cli/codexAgentRuntimeFactory.ts`
