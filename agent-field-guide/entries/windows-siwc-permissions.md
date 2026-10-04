# Windowsの資格情報保存では作成時ACLと子PowerShellの実環境を確認する

## When this matters

Bun/Nodeのファイル保存へWindowsの本人限定ACLを追加するとき、またはPowerShell 7からWindows PowerShell 5.1を子プロセスとして使うとき。

## Field note

POSIXのmodeやdirectory fsyncをWindows成功の証拠にしない。DirectorySecurityを新規directoryの作成時に渡し、ownerのSIDだけに許可する継承可能なACLを設定する。既存directoryは別物として検証し、広いACLを勝手に修復しない。保護済みdirectoryの子fileも、秘密を書き込む前に所有者とACLを検証する。

子のWindows PowerShellは親の環境を引き継ぐため、Get-Acl/Set-Aclが存在してもSecurityモジュールのautoloadに失敗する場合がある。実際にこの環境で失敗したが、Windows PowerShell 5.1の.NET Framework DirectoryInfo/FileInfo.GetAccessControlは利用できた。製品helperと検証用helperを混同せず、実ファイルで確認する。

## Reliable procedure

- 固定スクリプトへpath/URLをstdinのデータとして渡し、UTF-8 InputEncodingを明示する。日本語・引用符・角括弧・ampersand入りのpathで確認する。
- ACLだけでなくjunctionなどのreparse point（祖先も含む）とhardlinkも検証する。
- Windowsではfile flush→close→renameで保存し、directory fsyncは実行しない。失敗時に旧fileを先に削除しない。
- 複数Bunプロセスから同じlockを使う検証と、保存後に別インスタンスから読む検証を行う。
- 実ACLの外部process確認はモックより時間がかかる。高負荷の並行テストでは、その経路を繰り返すケースに限って待ち時間を調整する。

## Failure signals

chmodテストだけの成功、Windowsで認証テストがすべてskip、Get-AclのCouldNotAutoloadMatchingModule、更新後のdirectory fsync失敗、15秒timeout後に後処理が走ってENOTEMPTYになる場合。

## Recheck when

PowerShell/.NETバージョン、保存場所、ACLの許可先、ファイル置換方式、MSIX実行環境を変更するとき。ACLは同一ユーザーの別processや管理者からの隔離・暗号化ではない。

## 配布版でのPowerShellウィンドウ表示

補助PowerShellは`windowsHide: true`と`-WindowStyle Hidden`を併用する。SIWCのACL/ブラウザ処理だけでなく、設定画面のAPIキー資格情報ストアもPowerShellを使うため対象を取り違えない。非表示化のために権限確認を省略しない。

BunのGUI形式で作成した簡易probeのGetConsoleWindow/IsWindowVisibleがfalseでも、MSIX画面切替中の瞬間表示がない保証にはならない。起動引数のテスト、実ACLテスト、配布アプリでの目視確認を区別する。

以前の`2ca9ab9`のsidecar対策（Rust CREATE_NO_WINDOWとBun --windows-hide-console）は、sidecarが後から起動するCodexやripgrepのコンソールまで抑止しない。子のspawnにもwindowsHideを指定する。GUI形式Bunで、指定なしの子はIsWindowVisible=True、指定ありはFalseを実測し、修正後の本番Codex version probeでもFalse・exitCode0を確認した。PowerShellだけを対象にせず、全子プロセス境界を調べる。

## WebViewとloopbackのcross-site通信

Tauriのhttp(s)://tauri.localhostから127.0.0.1のsidecarへのfetchはsec-fetch-site=cross-siteとなり得る。外側のBearer+許可Origin検証に成功したnative通信へ、内側APIのWeb向けcross-site一律拒否を重ねると、provider一覧は取得できるのにSIWC設定だけ消える。preview無効と即断せず、設定に「その他の接続方法」が出るか、native headers付きAPIを統合テストする。不正token/外部Origin拒否も併せて保持する。
