# Codex診断ログの確認手順

> 旧機能の履歴資料。タスク231でGhostwriterのCodex CLI連携を撤去したため、現行版の操作・実装には適用しない。

Ghostwriterは、Codex CLI探索、App Server起動、ChatGPT account確認、`model/list`、inventory検証の状態を、サニタイズ済みJSONLとして`dataRoot/logs/codex-diagnostics.jsonl`へ記録します。

ログにはevent分類、成功・失敗、page数・model件数、allowlist済みmethodとerror kindだけを記録します。raw JSON-RPC、stdout/stderr、例外message/stack、email、token、prompt、原稿、modelの説明、実行ファイル・workspace・brokerの絶対pathは記録しません。最大512 KiBで、超過時は`.1`へ1世代だけローテーションします。ログI/Oに失敗してもCodex APIの結果は変更しません。

## Windows MSIX

MSIXのpackage dataはWindowsによりredirectされるため、物理pathを決め打ちせずPackage Family Name配下から探索します。モデル一覧取得を再現した後、通常PowerShellで次を実行します。

```powershell
$packageDataRoot = Join-Path $env:LOCALAPPDATA `
  'Packages\RyoHeiguchi.Ghostwriter-Novel_y1fsvxhecz606'

$diagnosticLogs = Get-ChildItem `
  -LiteralPath $packageDataRoot `
  -Filter 'codex-diagnostics.jsonl*' `
  -File `
  -Recurse `
  -ErrorAction SilentlyContinue

$diagnosticLogs |
  Select-Object FullName, Length, LastWriteTime

$diagnosticLogs |
  Sort-Object LastWriteTime |
  ForEach-Object {
    "=== $($_.Name) ==="
    Get-Content -LiteralPath $_.FullName
  }
```

ログが見つからない場合は、インストール済みpackageとPackage Family Nameを確認します。

```powershell
Get-AppxPackage -Name 'RyoHeiguchi.Ghostwriter-Novel' |
  Select-Object Name, Version, PackageFamilyName, Status
```

## Web開発版

既定設定ではリポジトリルートの`.data/logs/`を確認します。

```powershell
Get-Content `
  -LiteralPath '.data\logs\codex-diagnostics.jsonl' `
  -ErrorAction Stop
```

`GHOSTWRITER_DATA_DIR`を指定して起動した場合は、そのdirectoryの`logs/codex-diagnostics.jsonl`を確認します。

## 読み方

- `cli-health`: CLI候補のversion probeを含むinstallation health。
- `app-server`: App Server processの起動、終了、再起動、protocol failure。
- `mcp-host`: Windows packaged版のMCP host path検証。`stage`、固定`errorKind`、`redeployed`だけを記録し、source/target pathやOS error本文は記録しません。Tauriでの展開自体が失敗してsidecarを起動できない場合は、このJSONL loggerも開始前のためTauriの固定起動エラーを確認します。
- `model-inventory` / `connect`: CLI確認とApp Server接続段階。
- `model-inventory` / `account-read`: Ghostwriter専用`CODEX_HOME`のChatGPT account確認段階。
- `model-inventory` / `page-received`: `model/list`の1 pageをdecodeできた状態。記録するのはpage番号と件数だけです。
- `model-inventory` / `validation`: hidden model除外後にdefault modelが1件であることを検証する段階。
- `model-inventory` / `complete`: 公開inventoryの構築完了。
- `api-models`: `/api/codex/models`の最終結果。

MCP関連の固定分類は`mcp-host-prepare-failed`、`mcp-host-integrity-failed`、`mcp-host-access-denied`、`mcp-not-ready`です。`mcp-host`成功後に`mcp-not-ready`になる場合は、展開済みhostの実行または`mcpServerStatus/list`での`ghostwriter` / `Read`認識を確認します。

失敗行の`stage`と`errorKind`を、直前の成功行と合わせて確認します。ログを共有する前にも内容を確認し、想定外の個人情報がないことを確かめてください。
