# Windows MSIXのStore提出とローカルsideload

## When this matters

Windows x64向けにTauri成果物をビルドし、Microsoft Store提出用MSIXと、この開発PCで動作確認するための署名済みMSIXを扱うとき。

## Field note

Store提出用のMSIXは未署名で生成し、ローカル検証用にだけ別名のコピーへ自己署名する。署名済みコピーをStoreへ提出しない。ローカルインストール時の`0x800B0109`は、自己署名証明書がWindowsの信頼ストアに登録されていない状態を示す。

## Reliable procedure

1. `bun run version:check`でアプリバージョンを確認する。
   インストール済み版と同じversionで内容を変えたMSIXは更新できない。更新用buildでは`bun run version:set <新version>`で先にversionを上げる。古いアプリを削除して回避しない。
2. `bun run build:desktop:windows`で`x86_64-pc-windows-msvc`のTauri成果物を作り、`bun run package:windows:msix`でStore提出用の未署名MSIXを生成する。
3. `bun run validate:windows:msix`を実行し、manifestのIdentity、Publisher、x64、Version、`runFullTrust`だけのcapabilityを確認する。
4. ローカル検証時は元のMSIXを`*-local.msix`へコピーし、manifestのPublisherと同じSubject（現行は`CN=8A2DE4F5-8A62-43C8-83DF-8E6AD96575D9`）の一時証明書で署名する。
5. Windows SDKの`signtool.exe`がPATHにない場合は、`C:\Program Files (x86)\Windows Kits\10\bin\<SDK version>\x64\signtool.exe`をフルパスで呼び出す。署名自体は通常権限で実行できる。
6. `Add-AppxPackage`が`0x800B0109`で失敗したら、同じユーザーの管理者PowerShellで、署名に使った`.cer`を`Cert:\LocalMachine\Root`と`Cert:\LocalMachine\TrustedPeople`へ登録してから再実行する。
7. Store提出時は新しいsubmissionを作成し、Packagesには同一architecture/languageのパッケージを1つだけ残す。Saveがdisabledなら、`Update`/`Create new submission`から作り直し、検証完了を待つ。

## Failure signals

- `vite build`開始時にVoltaが`C:\Users\<user>\AppData\Local\Volta`を作れず終了する。ユーザー領域への書き込み権限を確認する。
- Node.jsがViteの要求版未満でも警告だけで継続する場合があるため、警告を無視せず終了コードと成果物を確認する。
- PowerShell 7からのbuildでWindows PowerShell 5.1の`Expand-Archive`が`CouldNotAutoloadMatchingModule`になる場合、親から継承した`PSModulePath`を確認する。今回成功した回避はbuildコマンドのプロセス内だけで`$env:PSModulePath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules'`を設定して再実行すること。ユーザー・マシン全体の環境変数は変更しない。
- `Get-Command signtool.exe`が失敗する場合は、SDK未導入ではなくPATH未設定のこともある。Windows Kits配下を検索する。
- `Add-AppxPackage`の`0x800B0109`は証明書チェーンの信頼不足であり、管理者権限でLocalMachineストアへ証明書を登録する。
- `0x80073CFB`で同じID・異なる内容と出る場合、出力フォルダーに古いMSIXが残っていることではなく、同じversionのアプリがインストール済みであることが原因。versionを上げて再build・pack・署名する。`-local.msix`という名前だけでは署名済みとは限らないので、`Get-AuthenticodeSignature`でも確認する。
- Partner CenterのSaveがdisabledなら、submissionが読み取り専用、検証中、必須項目未完了、または同一architecture/languageの重複である可能性が高い。

## Recheck when

Tauri、Windows SDK、Partner CenterのPackages画面、MSIX manifestのPublisher、またはStore提出版とsideload版の配布方針を変更するとき。

## Related work

- `scripts/desktop-runtime.ts`
- `scripts/windows-msix.ts`
