# Microsoft Store 審査メモ案

## 提出前の確認

- `Ghostwriter_1.0.10.0_x64.msix` を使用する。Partner Centerに登録する候補は未署名のMSIX。
- 審査メモには、サインインなしで確認できる執筆機能と、対応するChatGPTプランが必要な任意のAI機能の手順を記載する。Microsoftから追加の試験方法を求められた場合は、審査担当窓口に利用可能な方法を確認する。 [Microsoftの審査メモ案内](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options#notes-for-certification) · [OpenAIの利用規約](https://openai.com/policies/terms-of-use/)
- 対応するソースのコミットURLと、更新済みのプライバシーポリシーURLを確認する。

## Notes for certification

Ghostwriter-Novel is a Windows desktop editor for writing local manuscripts. The `runFullTrust` capability is used for the desktop application and its bundled local sidecar.

### Local editing without an account

1. Launch **Ghostwriter-Novel**. Select **ワークスペースを開く** (Open workspace) and choose a local folder containing a sample `.txt` file.
2. Open **エディットモード** (Edit mode) and select the sample file in the file tree. Edit the sample and select **保存** (Save). Reopen the file to check that the edits were saved.

### Optional AI features

ChatGPT features require an internet connection and an account with a supported ChatGPT plan. If a supported account is available to the certification team, use the steps below. ChatGPT sign-in is available at normal launch.

1. Launch **Ghostwriter-Novel**. Open **設定** (Settings), then **ChatGPTプラン接続** (ChatGPT plan connection). Select **Continue with ChatGPT**. Complete sign-in and authorization in the system browser and return to Ghostwriter. The connection shows **サインイン済み** (Signed in).
2. Open a local test workspace with a short sample manuscript. Open **チャットモード** (Chat mode), select **ChatGPTプラン** and a listed model, and ask for a short response about the sample. Verify that an answer appears. The usage icon at the bottom of the sidebar opens ChatGPT usage settings in the system browser.
3. Open **エディットモード** (Edit mode) and select the sample manuscript. In AI Assist, select **ChatGPTプラン** and a listed model. Click **推敲** (Revise) and verify that an edit proposal appears. The file is updated when you select **Apply**.
4. Close and reopen the app. Verify that the connection remains signed in. To disconnect, return to **設定** and select **ログアウト** (Sign out) in the ChatGPT connection section.
