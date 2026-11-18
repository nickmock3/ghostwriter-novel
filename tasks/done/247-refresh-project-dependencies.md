# プロジェクトの依存ライブラリを更新する

## 難易度

- 判定: 中
- 理由: Web、テスト、Tauriの複数の依存関係を更新する。型、実行環境、ネイティブ境界の互換性を既存のテストで確認する。

## 対象範囲

- npmおよびcrates.ioで公開された安定版を確認し、アプリと開発用の直接依存、関連する推移依存、ロックファイルを更新する。
- ReactとReact DOM、TanStack、TauriのJavaScript/Rustパッケージは組み合わせを確認する。現在のツールチェーンに適合する最新版を採用し、制約がある場合は理由を記録する。
- 既存動作を維持するために必要な小規模の互換修正を含める。OSのグローバル開発環境、公開・配布設定、LLMモデル一覧は対象外。

## 検証方針

- 新規の製品挙動を追加しない。既存の型チェック、Vitest全体、Playwright全体で型契約、ブラウザ起動と主要操作、保存、AI連携の回帰を検出する。
- Tauriは既存のdesktopビルド・Rustテスト・認証付きsidecar smokeで、起動とループバック通信の互換性を確認する。
- frozen lockfileでインストールできること、アプリのバージョン整合、差分を確認する。依存更新で具体的な回帰が見つかった場合は、既存テストの再現を優先する。

## 完了条件

- 更新対象の依存が固定ロックファイルからインストールできる。
- 変更した環境のテストが成功し、未確認環境と据え置いた依存の理由が記録されている。

## 更新結果

- React / React DOM 19.3.1、Vite 8.3.8、TanStack Router 1.170.46 / Start 1.169.5、CodeMirror関連、Zod 4.6.7、jose 6.2.17、Vitest 5.1.0、Playwright 1.65.1、Testing Libraryなどをnpmで確認した公開安定版へ更新。TanStackが生成するルートツリーは生成結果を反映した。
- TauriのJavaScript API・CLIは2.12.5、Rust側はTauri 2.12.6 / tauri-build 2.7.5。対応するdialog・openerプラグインとcrateを揃え、getrandom 0.4.3、ureq 3.5.2、関連crateを更新した。Cargo.lockはRust 1.93.1で互換性を優先して解決した。
- AI SDK本体7.0.176と4つのプロバイダーは前回更新した版が公開最新であることを確認した。
- TypeScriptは依存境界テストのCompiler APIを維持するため6.0.3を固定。jsdomはNode 22.17.1で動く最新の29.1.1に更新。jsdom 30以降は22系では22.22.2以上が必要。Node型定義は既存メジャーの最新版25.9.9に更新した。[TypeScript 7.0のCompiler APIに関する公式案内](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)

## 互換修正と検証

- 新しいPlaywrightの`--list`で、保存E2EがLLMプロフィールの実行時依存まで読み込んだときにNodeのCommonJSローダーが失敗することを確認。型検査付きHTTP fixtureへ変更し、収集と実保存・Apply・Undoを検証した。更新前の別ディレクトリでは旧Playwrightによる収集が成功した。
- ureq 3の既定では環境プロキシが適用される。到達不能なループバックプロキシと空のNO_PROXYを指定した既存sidecar smokeは修正前に失敗し、health checkリクエストでプロキシを無効にした後に成功した。
- `bun install --frozen-lockfile`、`cargo metadata --locked --offline`、`bun run typecheck`、`bun run version:check`、`git diff --check`が成功。`bun run test`は1,249件成功、既存6件スキップ。新しいChromium 159で`bun run test:e2e -- --workers=3`は30件成功。
- macOS Apple Siliconで既存の26.5 SDKをコマンド単位で指定した`bun run test:desktop`が成功。Web本番ビルドと静的SPA準備、認証付きsidecar smoke、Rust単体14件、関連Vitest 76件を確認した。
- ブラウザーの初期表示を更新前後で比較し、両方でルート `/` の同じ一時的なReact hydration復旧ログと、その後の描画完了を確認した。`cargo fmt --check`は未変更のRust整形差分を報告した。
- Windows実機・配布バンドルはこの環境では未確認。LLMの接続方式とAI SDK版は既存のため実サービスは呼び出していない。
