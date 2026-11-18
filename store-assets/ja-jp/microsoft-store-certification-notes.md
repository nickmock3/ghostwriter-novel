# Microsoft Store 審査メモ案

## 提出前の確認

- `Ghostwriter_1.0.10.0_x64.msix` を使用する。Partner Centerに登録する候補は未署名のMSIX。
- 対応するChatGPTプランで、審査担当者がブラウザー認証と利用許可を完了できる試験用アクセスを用意する。必要な試験情報はPartner Centerの審査メモ欄で扱う。個人のアカウント、認証トークン、APIキーをこの文書に記載しない。
- 対応するソースのコミットURLと、更新済みのプライバシーポリシーURLを確認する。

## Notes for certification

Ghostwriter-Novel is a Windows desktop editor for writing local manuscripts. Local editing is available without signing in. To test the optional AI features below, use the provided test access for a supported ChatGPT plan and an internet connection. The Windows package enables ChatGPT sign-in at normal launch. The `runFullTrust` capability is used for the desktop application and its bundled local sidecar.

1. Launch **Ghostwriter-Novel**. Open **設定** (Settings), then **ChatGPTプラン接続** (ChatGPT plan connection). Select **Continue with ChatGPT**. Complete sign-in and authorization in the system browser and return to Ghostwriter. The connection shows **サインイン済み** (Signed in).
2. Open a local test workspace with a short sample manuscript. Open **チャットモード** (Chat mode), select **ChatGPTプラン** and a listed model, and ask for a short response about the sample. Verify that an answer appears. The usage icon at the bottom of the sidebar opens ChatGPT usage settings in the system browser.
3. Open **エディットモード** (Edit mode) and select the sample manuscript. In AI Assist, select **ChatGPTプラン** and a listed model. Click **推敲** (Revise) and verify that an edit proposal appears. The file is updated when you select **Apply**.
4. Close and reopen the app. Verify that the connection remains signed in. To disconnect, return to **設定** and select **ログアウト** (Sign out) in the ChatGPT connection section.
