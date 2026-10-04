# Windows MSIX sideload実機検証

この手順は、Microsoft Store提出前のGhostwriter MSIXをWindows x64実機で検証するためのものです。署名用の秘密鍵は`CurrentUser\My`だけへ作成し、公開証明書をMicrosoftのsideload要件に従って`LocalMachine\TrustedPeople`へ一時登録します。Store提出用の未署名MSIXは変更しません。

## 前提

- リポジトリルートで`bun run package:windows:msix`が成功している。
- Windows SDKの`SignTool.exe`がインストールされている。
- 手順1から3とMSIXの署名・インストールは通常ユーザーのPowerShellで行う。公開証明書を`LocalMachine\TrustedPeople`へ登録・削除する操作だけ、管理者PowerShellで行う。
- Store提出用の`dist/windows-msix/Ghostwriter_1.0.1.0_x64.msix`を直接署名しない。

以下のコマンドは、同じPowerShellセッションで上から順に実行します。

## 1. 一時作業領域を準備する

```powershell
$repoRoot = (Get-Location).Path
$kitRoot = Join-Path $env:TEMP 'ghostwriter-msix-sideload'
$publisher = 'CN=8A2DE4F5-8A62-43C8-83DF-8E6AD96575D9'
$unsignedMsix = Join-Path $repoRoot 'dist\windows-msix\Ghostwriter_1.0.1.0_x64.msix'
$signedMsix = Join-Path $kitRoot 'Ghostwriter_1.0.1.0_x64-sideload.msix'
$publicCertificate = Join-Path $kitRoot 'Ghostwriter-MSIX-Test.cer'

New-Item -ItemType Directory -Force -Path $kitRoot | Out-Null
Copy-Item -LiteralPath $unsignedMsix -Destination $signedMsix -Force
```

`$kitRoot`はリポジトリ外の一時領域です。Store提出用MSIXは未署名のまま残ります。

## 2. 現在のユーザー用テスト証明書を作成する

```powershell
$certificate = New-SelfSignedCertificate `
  -Type Custom `
  -Subject $publisher `
  -FriendlyName 'Ghostwriter MSIX sideload test' `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -KeyUsage DigitalSignature `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')

$thumbprint = $certificate.Thumbprint
Export-Certificate -Cert $certificate -FilePath $publicCertificate | Out-Null
$publicCertificate
$thumbprint
```

表示された公開証明書の絶対パスとthumbprintを検証終了まで控えます。秘密鍵は`CurrentUser\My`から外へexportしません。

## 3. テスト用コピーだけを署名する

```powershell
$signTool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' `
  -Recurse `
  -Filter SignTool.exe |
  Where-Object { $_.FullName -match '\\x64\\SignTool\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $signTool) {
  throw 'SignTool.exeが見つかりません。Windows SDKを確認してください。'
}

& $signTool sign /fd SHA256 /sha1 $thumbprint /s My $signedMsix
if ($LASTEXITCODE -ne 0) {
  throw "SignTool failed with exit code $LASTEXITCODE"
}

Get-AuthenticodeSignature -LiteralPath $signedMsix |
  Select-Object Status, StatusMessage, @{Name='Subject';Expression={$_.SignerCertificate.Subject}}
```

この時点では自己署名証明書をまだ信頼していないため、`Status`は`Valid`にならない場合があります。`Subject`がPartner Center Publisherと一致し、署名者証明書が表示されることを確認します。

## 4. 公開証明書を信頼する

この操作はローカルコンピューター全体の`TrustedPeople`を変更します。PowerShellを管理者として別に起動し、公開証明書のpathとthumbprintを明示して実行します。管理者セッションが別ユーザーの場合は一時フォルダーが異なるため、`$env:TEMP`から推測せず手順2で控えたパスを使います。

```powershell
$publicCertificate = Read-Host '手順2で表示された公開証明書の絶対パス（引用符なし）'
$thumbprint = '手順2で表示されたthumbprint'

Import-Certificate `
  -FilePath $publicCertificate `
  -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople'

Get-Item -LiteralPath "Cert:\LocalMachine\TrustedPeople\$thumbprint" |
  Select-Object Thumbprint, Subject
```

確認後、管理者PowerShellを閉じます。元の通常ユーザーPowerShellへ戻り、署名状態を再確認してからインストールします。

```powershell
Get-AuthenticodeSignature -LiteralPath $signedMsix |
  Select-Object Status, StatusMessage, @{Name='Subject';Expression={$_.SignerCertificate.Subject}}

Add-AppxPackage -Path $signedMsix
```

証明書登録後の`Status`が`Valid`、`Subject`がPartner Center Publisherと一致することを確認してから、MSIXをインストールします。インストール後にスタートメニューから`Ghostwriter`を起動します。

## 5. 初回インストールの確認

- [ ] スタートメニューから起動できる。
- [ ] sidecar準備中表示の後、エディターが利用可能になる。
- [ ] 新規ワークスペースを作成できる。
- [ ] 既存ワークスペースをネイティブダイアログで選択できる。
- [ ] ファイルの作成、編集、保存、再読込ができる。
- [ ] `PATH`上の`rg.exe`を一時的に除外しても検索できる。
- [ ] APIキーをWindows Credential Managerへ保存、更新、削除できる。
- [ ] AI providerで応答と編集proposalを確認できる。
- [ ] Codex利用環境ではログイン状態、会話、Read、Create/Edit Apply、自動適用、Undoを確認できる。
- [ ] Codexモデル一覧取得後、`codex-diagnostics.jsonl`に`mcp-host`成功と`model-inventory`の`account-read`、`model-list`、`complete`が記録される。
- [ ] `dataRoot/codex-mcp-hosts/<64文字SHA-256>/ghostwriter-mcp-host.exe`が作成され、同EXE単体の`--mcp-server`が`tools/list`で7 toolsと`Read`を返す。
- [ ] Codex App Serverの`mcpServerStatus/list`が`ghostwriter`、7 tools、`Read`を返す。
- [ ] 展開済みMCP hostを破損させた検証では、不正targetが起動されず再展開または固定integrity errorになる。旧versionを実行中にした更新検証では、旧file cleanup失敗が新version起動を妨げない。
- [ ] アプリ終了後に`ghostwriter-sidecar.exe`や子processが残らない。

診断用コマンド:

```powershell
Get-AppxPackage -Name 'RyoHeiguchi.Ghostwriter-Novel' |
  Select-Object Name, Version, PackageFamilyName, InstallLocation

Get-Process ghostwriter, ghostwriter-sidecar, rg -ErrorAction SilentlyContinue |
  Select-Object ProcessName, Id, Path
```

## 6. 更新とデータ保持を確認する

更新用MSIXを生成するまでは、証明書を`CurrentUser\My`と`LocalMachine\TrustedPeople`へ残します。更新用パッケージは同じIdentity、Publisher、証明書を使い、現在より大きいMSIX versionで署名します。

- [ ] 旧versionで会話履歴、設定、ワークスペース参照を作成する。
- [ ] Credential Managerへテスト用secretを保存する。
- [ ] 新versionを`Add-AppxPackage -Path <signed-update.msix>`で更新する。
- [ ] 会話履歴、設定、ワークスペース参照、secretが保持される。
- [ ] MSI preview版が存在する場合は、先にアンインストールする移行方針を確認する。

## 7. 検証後にクリーンアップする

先にGhostwriter MSIXをアンインストールします。

```powershell
Get-AppxPackage -Name 'RyoHeiguchi.Ghostwriter-Novel' | Remove-AppxPackage
```

通常ユーザーPowerShellで、署名用の秘密鍵と一時ファイルを削除します。

```powershell
Remove-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $kitRoot -Recurse -Force
```

続けて管理者PowerShellを起動し、作成したthumbprintと一致する公開証明書だけをローカルコンピューターから削除します。

```powershell
$thumbprint = '手順2で表示されたthumbprint'
Remove-Item -LiteralPath "Cert:\LocalMachine\TrustedPeople\$thumbprint"
```

最後に、通常ユーザーPowerShellと管理者PowerShellのそれぞれで残存を確認します。

```powershell
# 通常ユーザーPowerShell
Get-AppxPackage -Name 'RyoHeiguchi.Ghostwriter-Novel'
Get-ChildItem 'Cert:\CurrentUser\My' |
  Where-Object Thumbprint -eq $thumbprint

# 管理者PowerShell
Get-ChildItem 'Cert:\LocalMachine\TrustedPeople' |
  Where-Object Thumbprint -eq $thumbprint
```

どちらも何も返さなければ、テスト用パッケージと証明書のクリーンアップは完了です。
