# Viteを使うE2E検証中はReact contextのソース編集を止める

## When this matters

PlaywrightがVite開発サーバーを起動する構成で、検証とソース整形・import整理を並行するとき。

## Field note

E2E実行中に`LlmSettingsContext.tsx`を含むソースを整形したところ、後続ケースで`useLlmSettingsContext must be used inside App.`となり、画面のボタン待ちがtimeoutした。同じコードで編集を止めて開発サーバーを再起動した全体E2Eは成功した。この観測ではVite HMRによるcontextの再評価が原因と考えられるが、恒常的な製品不具合とは確認していない。

## Reliable procedure

1. Playwrightの失敗時は`test-results`の画面snapshotを確認し、locator不一致か画面側の例外かを分ける。
2. 実行中にcontext/providerを含むソース変更があった場合、編集を止め、既存の開発サーバーを終了したうえで同じE2Eを再実行する。
3. 安定したソースでも再現する場合にcontext/providerの実装を調べる。一度のHMR中の失敗だけを理由に製品やテストの待機条件を変更しない。

## Failure signals

先行ケースは成功しているのに、編集中の後続ケースでcontextのprovider欠落エラー画面が現れる。ボタンのtimeoutの裏で画面全体がerror boundaryへ切り替わっている。

## Recheck when

Vite、React Fast Refresh、context/providerの配置、PlaywrightのwebServer設定を変えたとき。
