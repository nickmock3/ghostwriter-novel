# 248 Microsoft Store更新に向けてChatGPT直接ログインの利用導線を整える

## 背景と目的

Ghostwriterは[MITライセンスで公開済み](https://github.com/nickmock3/ghostwriter-novel)で、Windows版はMicrosoft Storeで無料配布している。OpenAIの[OSS・ローカルアプリ向け案内](https://developers.openai.com/siwc/token-sharing-open-source)を前提に、ChatGPT直接ログイン（SIWC）を次のStore更新で一般利用に提供するための画面と案内を整える。

[229](../open/229-release-siwc-desktop-integration.md)から、現行ガイドとの差分対応、Store掲載文の更新、Windows配布候補の利用フロー確認を切り出す。既定で有効にする判断と一般公開は229で扱う。

## 難易度

- 判定: 高
- 理由: 設定・チャット・AIアシストにまたがる初回表示とエラー時の操作を整える。単一接続の設計と公式ガイドの整合に判断が必要で、変更範囲に応じて認証の回帰とWindows配布版の実動作を確認する。

## 対象範囲

- 設定のサインインボタンを公式の表記・ブランド指針と照合する。初回のプラン利用許可後に一度だけ、対象のAIリクエストにChatGPTプランが使われることと、使用状況の確認方法を案内する。再ログイン時は同じ案内を繰り返さない。[UI/UXガイド](https://developers.openai.com/siwc/ui-ux-guidelines)
- チャットとAIアシストのモデル選択付近にChatGPTプラン利用中の表示と[利用状況を管理](https://chatgpt.com/settings/usage)への導線を設ける。利用上限到達時も同じ導線を主な操作として案内し、対象外・権限不足・認証切れと区別する。既存のAPIキー接続への自動切替禁止を維持する。[エラーと復旧](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- 現在接続中のアカウントの表示と、別アカウントを使う場合の導線を、公式の登録・セッションガイドと照合する。単一接続を維持できるか、追加・切替が必要かを判断し、根拠と対応範囲を記録する。接続仕様を変える場合は、保存済み会話のアカウントとの紐付けと資格情報の分離を維持する。[登録とサインイン](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)・[アカウントとセッション](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [日本語のStore掲載文](../../store-assets/ja-jp/microsoft-store-listing-ja-JP.md)の旧Codex案内を置き換え、対応するChatGPTプランで直接ログインできることと、対応するAPIキー接続が使えることを記載する。変更した挙動を[製品仕様](../../specs/novel-editor-mvp.md)・[SIWC仕様](../../specs/siwc-responses-migration.md)に、検証結果を[SIWC検証と公開状況](../../docs/siwc-validation-status.md)に反映する。Partner Centerへの提出は229の公開判断後に行う。

## 検証方針

- 着手時に難易度「高」を再確認した。公式のAccounts and sessionsは複数登録の管理を要求しており、現行の単一接続UIと差がある。既存の登録・選択・会話bindingを使って設定に追加と切替を戻す。初回案内の表示と再表示防止、登録の選択と追加、プラン表示の条件と上限時の操作を先行テストする。

- 実装前に、初回案内の欠落・再表示、利用中表示の誤表示、上限到達時に使用状況を開けない問題を検出するテストを優先する。設定と利用中・エラー時の分岐は近接のVitest、代表的な画面操作は既存のSIWC Playwrightで確認する。上限・対象外・権限不足はテスト応答で再現する。認証・アカウント管理の契約を変更する場合は、該当する層に回帰確認を追加する。
- `bun run test`、`bun run typecheck`、関連する`bun run test:e2e -- e2e/siwc-settings.spec.ts e2e/siwc-workflow.spec.ts`を実行する。desktop起動・通信・外部ブラウザーを開く処理のネイティブ境界を変更した場合は`bun run test:desktop`も実行する。
- SIWCを有効にしたWindows x64配布候補で、初回ログイン、システムブラウザーからの復帰、チャットとAIアシストの実リクエスト各1回、利用状況リンク、ログアウトを確認する。Windowsのトークン更新・保存は[実機検証済み](../../docs/siwc-validation-status.md)のため、その境界に変更がある場合に再検証する。

## 完了条件

- 初回ログイン前後と利用中・上限到達時の案内が確認でき、アカウントの表示・切替方針が記録されている。
- 日本語のStore掲載文と機能仕様が配布候補の挙動に合っている。
- 自動テストとWindows配布候補の確認結果が記録され、229で公開可否を判断できる。

## 実装と判断

- 「Continue with ChatGPT」に公式ボタン素材を同梱し、プラン利用の許可後に一度だけ案内を表示する。チャットとAIアシストでは利用可能なChatGPT接続とモデルが選択されている場合に利用中表示を出し、利用上限時はChatGPTの利用状況を案内する。
- 公式ガイドでは複数の登録を管理するため、設定で現在の登録と保存済み登録を選べるようにした。登録・資格情報は分離したまま、アプリ内で有効な登録を1つに保つ。変更前に保存した会話の登録とモデルは引き継ぐ。[アカウントとセッション](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- Windows x64の1.0.7.0へ更新し、実サインインとブラウザーからの復帰、初回案内、チャットとAIアシストの実応答、利用状況ページ、ログアウト・再ログイン後の案内再表示防止を確認した。[検証状況](../../docs/siwc-validation-status.md)
- 型チェック、Vitest全体、関連Playwright、MSIX検証・署名検証は成功。別登録への切替、許可不足からの再同意、利用上限等の分岐は自動テストで確認した。公開判断は229で継続する。
