# Codex model picker preflight（Task 138 決定記録）

> 廃止済みの調査記録。タスク231で旧Codex CLI連携を撤去したため、以下は現行製品の仕様・実装要件ではない。

- Owner: Ghostwriter
- 検証日時: 2026-07-14 14:39 JST
- 対象: ChatGPT.app 同梱 Codex App Server によるモデル inventory 取得と picker 実装可否
- 前提: `docs/archive/codex-app-server-preflight.md` の transport・安全境界・thread lifecycle 契約を継承する

この文書は Task 138 の検証結果と、後続実装（提案タスク 139）へ渡す契約を固定する。実装・MVP 改訂・タスクファイル作成は本タスクの対象外とする。

---

## 1. Decision（決定）

**分類: モデル一覧を取得して選択 UI を実装可能 — ただし、稼働中の認証済み App Server が返す動的 allowlist をサーバー側が唯一の権威とする場合に限る。**

| 区分 | 内容 |
|---|---|
| **検証済み事実** | ChatGPT.app 同梱 CLI `0.144.2` で、`initialize.capabilities.experimentalApi` を設定せずに `model/list` が成功し、可視 inventory を取得できた。`thread/start` と `turn/start` でモデル指定・再開・次ターン変更が動作し、会話履歴の連続性を確認した。 |
| **推論** | Ghostwriter は inventory を取得・正規化し、会話単位で選択を保存し、`thread/start` / `turn/start` 送信前にサーバー側で allowlist 検証すれば picker を安全に提供できる。 |
| **未検証** | ChatGPT Plus 以外のプラン、Enterprise / workspace ポリシー、Windows、実行可能な外部 CLI、ページネーションの実データ、`hidden: true` モデルの実表示。 |

**採用しない方針（検証済み事実に基づく）:**

- クライアント送信の任意 model 文字列を信用しない。
- `thread/start` の成功を capability 検証とみなさない（無効 model でも echo され、turn 実行時に HTTP 400 で失敗する）。
- inventory 取得成功を quota 残量の証明とみなさない（`account/rateLimits/read` は per-model entitlement を証明しなかった）。
- 別 provider への自動 fallback は行わない。
- 固定のハードコード model カタログを UI に載せない（観測 inventory は日付付きスナップショットであり、恒久カタログではない）。

**MVP との関係（推論）:** 現行 `specs/novel-editor-mvp.md` は互換性検証まで picker を提供しないとしている。本タスクでは MVP を編集しない。実装タスク 139 でコードと同時に MVP を更新する。

**現行 Ghostwriter 実装ギャップ（検証済み事実）:** `model/list` decoder、allowlist、`turn/start` の `model` フィールドは未実装。解決済み runtime model メタデータの記録のみ存在する。

---

## 2. Environment matrix（検証環境）

| 項目 | 値 | 区分 |
|---|---|---|
| 検証日時 | 2026-07-14 14:39 JST | 検証済み事実 |
| OS / arch | macOS 26.5.2 / arm64 | 検証済み事実 |
| ChatGPT プラン | Plus（`account/read` で `chatgpt` / `plus` を確認） | 検証済み事実 |
| 同梱 CLI | ChatGPT.app bundled `codex-cli 0.144.2` — JSON-RPC 成功 | 検証済み事実 |
| 外部 launcher | npm `@openai/codex` `0.98.0` — vendor binary 欠落で JSON-RPC 前に ENOENT 失敗 | 検証済み事実 |
| Windows | 未検証 | 未検証 |
| Free / Go / Pro / Team / Enterprise | 未検証 | 未検証 |
| workspace model policy | 未検証（公式 doc のみ参照） | 未検証 |

`@openai/codex` `0.98.0` の修復・サポート宣言は本プロジェクトの対象外とする（検証済み事実: 起動不能のため検証不能）。

---

## 3. Official / schema evidence（公式・スキーマ根拠）

### Source of Truth（優先順位）

| 優先 | ソース | URL / 手段 | 区分 |
|---:|---|---|---|
| 1 | 実 RPC レスポンス | 本文 §4・§5 | 検証済み事実 |
| 2 | CLI 生成 schema | `codex app-server generate-json-schema`（0.144.2） | 検証済み事実 |
| 3 | App Server 概要 | https://learn.chatgpt.com/docs/app-server.md | 公式 |
| 4 | Models 概要 | https://learn.chatgpt.com/docs/models.md | 公式 |
| 5 | Workspace model availability | https://learn.chatgpt.com/docs/enterprise/workspace-model-availability.md | 公式（Enterprise 向け。今回の Plus 実機では未適用） |

### `model/list` schema（0.144.2 生成、検証済み事実）

- **検証済み事実:** `initialize` で `capabilities.experimentalApi` を設定しなかった状態でも `model/list` が成功した。experimental フラグなしでの可用性のみ確認し、将来の安定性や schema 恒久性は未証明。
- **params（すべて optional）:** `cursor?`, `includeHidden?`, `limit?`
- **success result 必須:** `data: array`, `nextCursor?`（nullable）
- **各 model エントリ必須 field:** `id`, `model`, `displayName`, `description`, `hidden`, `isDefault`, `defaultReasoningEffort`, `supportedReasoningEfforts`
- **その他 advertised field（decoder では未知 field を fail-closed）:** service tiers、availability NUX、upgrades、modalities、personality support 等

### 併用して成功した RPC（検証済み事実）

| Method | 結果 |
|---|---|
| `initialize` | 成功 |
| `model/list` | 成功 |
| `account/read` | 成功（`chatgpt` / `plus`。email は記録・転記しない） |
| `account/rateLimits/read` | 成功（per-model entitlement は証明されず） |
| `configRequirements/read` | 成功（`null`） |

---

## 4. Sanitized RPC result table（サニタイズ済み応答形状）

識別子・token・email・機械固有 path は記録しない。以下は shape のみ。

### `model/list` — success

| Field | Type | Required | Notes |
|---|---|---:|---|
| `data` | `ModelInfo[]` | yes | ページ単位の inventory |
| `data[].id` | string | yes | 内部 ID |
| `data[].model` | string | yes | `thread/start` / `turn/start` へ渡す model 識別子 |
| `data[].displayName` | string | yes | UI 表示名 |
| `data[].description` | string | yes | 説明文 |
| `data[].hidden` | boolean | yes | `true` は既定 UI から除外（`includeHidden` 未検証） |
| `data[].isDefault` | boolean | yes | Codex 既定 model の印 |
| `data[].defaultReasoningEffort` | string / enum | yes | reasoning 既定 |
| `data[].supportedReasoningEfforts` | array | yes | 利用可能 reasoning effort |
| `nextCursor` | string \| null | no | 次ページ。実データ pagination は未検証 |

### `model/list` — failure（推論: 既存 preflight error 契約に準拠）

| 条件 | 想定 shape | Ghostwriter 扱い |
|---|---|---|
| 未認証 | JSON-RPC error / `unauthorized` | picker 非表示、login 誘導 |
| 未対応 CLI | `-32601` method not found | picker 非表示、unsupported-version |
| decode 失敗 | 未知必須 field 欠落 | fail-closed、picker 非表示、既定 model のみ |
| transport 断 | process error | picker 非表示、inventory stale 扱い |

### `thread/start` — success（有効 model、検証済み事実）

同梱 `0.144.2` では `model` / `modelProvider` は result の top-level に返る。thread 識別子は `thread.id`。

| Field | 観測値（shape） |
|---|---|
| `model` | 要求した model（例: `gpt-5.6-sol`） |
| `modelProvider` | `openai` |
| `thread.id` | 永続 thread 識別子 |
| `cwd` | broker 空 directory（小説 workspace 外） |
| `approvalPolicy` | `never` |
| `sandbox` | `readOnly`、network `false` |

**推論:** `thread/start` 成功は model が実行可能であることの証明ではない（§6 無効 trace 参照）。

### `thread/start` — 無効 model echo（検証済み事実）

| 段階 | shape |
|---|---|
| `thread/start` result | 任意文字列（例: `task138-definitely-not-a-model`）を top-level `model` に echo |
| `turn/start` → `turn/completed` | `status: failed`、upstream HTTP 400 unsupported model、`codexErrorInfo: other` |

### `thread/resume` — success（model 変更後、検証済み事実）

| Field | 観測 |
|---|---|
| `thread.id` | `thread/start` と同一 |
| `model` | 直近に解決された model（例: `gpt-5.6-terra`） |
| `modelProvider` | `openai` |

### `turn/start` — model 変更 success（検証済み事実）

| Field | 観測 |
|---|---|
| `params.model` | 次ターンで別 model（例: Sol → Terra）を指定可能 |
| `turn/completed` | 成功、直前ターンの文脈を保持 |

### `account/rateLimits/read` — success（検証済み事実）

| Field | 観測 |
|---|---|
| `rateLimits` | snapshot 取得可能 |
| per-model quota | **証明されない** — inventory と rate limit の対応は未検証 |

---

## 5. Observed inventory（観測 inventory）

**区分: 検証済み事実（2026-07-14 14:39 JST、Plus、同梱 0.144.2）— 恒久カタログではない。**

| model | displayName | isDefault | hidden（観測） |
|---|---|---:|---|
| `gpt-5.6-sol` | GPT-5.6-Sol | yes | false |
| `gpt-5.6-terra` | GPT-5.6-Terra | no | false |
| `gpt-5.6-luna` | GPT-5.6-Luna | no | false |
| `gpt-5.5` | GPT-5.5 | no | false |
| `gpt-5.4` | GPT-5.4 | no | false |
| `gpt-5.4-mini` | GPT-5.4-Mini | no | false |

`includeHidden: true` 時の追加エントリ、Enterprise workspace によるフィルタ、プラン差分は未検証。

---

## 6. Thread model change and history continuity（モデル変更と履歴連続性）

### 有効 model trace（検証済み事実）

1. **thread/start** — `params.model: gpt-5.6-sol`。result top-level に `model` / `modelProvider: openai`、`thread.id`、broker cwd、`approvalPolicy: never`、`sandbox: readOnly`、network `false`。
2. **turn/start（1）** — 応答に固定 marker `FIRST_OK` を含む。
3. **thread/resume** — 同一 `thread.id`、top-level `model` は Sol のまま。
4. **turn/start（2）** — `params.model` を `gpt-5.6-terra` に変更。応答は直前ターンの marker `TASK138_ALPHA` を記憶。
5. **thread/resume** — 同一 `thread.id`、top-level `model` は Terra に更新。
6. **thread/delete** — 永続 thread の削除成功。

**本 trace の live 範囲（検証済み事実）:** MCP tool 呼び出し、proposal 作成、Apply / Undo は実行していない。`thread/start` 時点で broker cwd・read-only sandbox・`approvalPolicy: never`・network `false` が維持されたことのみを確認した。

**推論:** 会話単位の model 選択は初回 `thread/start` と、以降の `turn/start.model` 変更の両方で表現できる。Ghostwriter は会話 metadata に「現在選択 model」を保持し、resume 時に result top-level の解決 `model` と整合させる。MCP workspace 境界と proposal Apply / Undo の非回帰は `codex-app-server-preflight.md` から継承する契約であり、Task 139 の自動化 / 統合テストで確認する。

### 無効 model trace（検証済み事実）

1. **thread/start** — 存在しない model 文字列を指定しても RPC は成功し、top-level `model` に echo される。
2. **turn/start** — upstream HTTP 400、`turn/completed` は `failed`。

### ephemeral 無効 thread（検証済み事実）

- `ephemeral: true` の無効 model thread は非永続。`thread/delete` クリーンアップは適用外。
- これを製品欠陥と呼ばない（仕様上の ephemeral 挙動）。

---

## 7. Safety / trust boundary / failure behavior（安全・信頼境界・失敗時挙動）

### 信頼境界

| 層 | 規則 | 区分 |
|---|---|---|
| クライアント | model 文字列を送信してよいが、サーバーが無視・拒否する | 契約（推論） |
| Ghostwriter server | 直近の `model/list` から構築した allowlist 以外を拒否 | 契約（推論） |
| App Server | `thread/start` は無効 model を受理し得る | 検証済み事実 |
| 実行時 | `turn/completed` の失敗・rate limit が最終権威 | 検証済み事実 |

### 失敗時フォールバック（契約）

| 条件 | 挙動 |
|---|---|
| inventory 取得失敗 | picker 非表示、`thread/start` / `turn/start` へ model を省略し Codex 既定を使用 |
| inventory が stale（TTL 超過等） | 同上 |
| CLI が `model/list` 非対応 | 同上 |
| クライアントが未知 model を要求 | RPC 前に 4xx で拒否。App Server へ渡さない |
| turn 実行時の unsupported model / quota | サニタイズしたユーザー向けエラー。別 provider へ fallback しない |

### 維持する既存安全設定（契約 — `codex-app-server-preflight.md` 継承）

Task 138 の model 変更 live trace では、次項のうち `thread/start` 由来の broker cwd・read-only sandbox・`approvalPolicy: never`・network `false` の維持のみを実機確認した。MCP / proposal 項目は live 再実行しておらず、継承契約と Task 139 テスト対象とする。

- broker cwd（小説 workspace を Codex cwd に渡さない）— **live 確認済み（thread/start）**
- `approvalPolicy: never` — **live 確認済み（thread/start）**
- `sandbox: read-only`、network `false` — **live 確認済み（thread/start）**
- MCP workspace / tool 境界（Ghostwriter 管理 MCP のみ）— 継承契約。Task 139 で検証
- 書き込みは proposal Apply 経由 — 継承契約。Task 139 で検証
- proposal Apply / Undo の承認・衝突・取り消し挙動 — 継承契約。Task 139 で検証

---

## 8. Implemented API and per-conversation persistence（実装 API・永続化契約）

**区分: Task 139 production契約。検証traceの事実と区別し、実装の正として扱う。**

### Server API（Ghostwriter → クライアント）

```
GET /api/codex/models
```

| 項目 | 契約 |
|---|---|
| 認証 | Codex backend が ready（`chatgpt` account）のときのみ |
| 成功 body | `{ models: SanitizedModel[], defaultModelId: string, fetchedAt: ISO8601 }` |
| `SanitizedModel` | `id`, `model`, `displayName`, `description`, `isDefault` のみ。内部 tier / NUX / upgrade field は UI に露出しない |
| 失敗 | `503` + `{ available: false }` — picker 非表示 |

```
PATCH /api/conversations
```

| 項目 | 契約 |
|---|---|
| body | `{ action: "setCodexModel", conversationId: string, workspaceRoot: string, model: string \| null }` |
| 検証 | サーバー allowlist に存在すること |
| 効果 | 会話 metadata の `selectedCodexModel` を更新。次回 `turn/start` から適用 |
| `null` | 明示選択を解除し、App Server既定modelへ戻す |
| 進行中 turn | `409`で拒否し、進行中turnへは割り込まない |

### 永続化単位

| 保存先 | field | 規則 |
|---|---|---|
| 会話 metadata | `selectedCodexModel: string \| null` | 新規会話: ユーザー選択または null（既定） |
| 会話 metadata | `codexThreadId` | 既存契約どおり。model 変更でも thread を破棄しない |
| 会話 metadata | `codexRuntimeMetadata.model` | `thread/start` / `thread/resume`で観測した前回の実効model（表示・診断用）。選択値とは混同しない |
| グローバル設定 | なし | プラン横断の既定は App Server `isDefault` を都度読む |

### RPC 送信規則

| タイミング | `model` の渡し方 |
|---|---|
| 新規 `thread/start` | `selectedCodexModel` が allowlist にあるときのみ `params.model` に設定 |
| `thread/resume` | model は送らない（resume result top-level の `model` を正とする） |
| 各 `turn/start` | 会話に選択があるとき `params.model` を設定（ターン間変更を反映） |
| inventory 不可用 | すべての RPC で `model` を省略 |

---

## 9. Proposed tests（提案テスト）

**区分: 推論（Task 139 で実装）**

### Decoder / inventory

- `model/list` success を strict decoder で検証。必須 field 欠落・型不一致は fail-closed。
- 未知 top-level field は拒否（安全性に関わる契約 field は厳格、表示用は preflight 方針に合わせる）。
- `nextCursor` がある fixture で pagination ループが 1 回以上続くこと（fixture ベース。live pagination は未検証）。
- `hidden: true` エントリが sanitized API から除外されること。
- 複数 `isDefault: true` など異常 inventory は fail-closed または最初の 1 件のみ採用。

### Allowlist / クライアント入力

- allowlist 外 model を `PATCH` または内部 API で指定 → RPC 前に拒否。
- `thread/start` mock が任意 model を echo しても、サーバーが事前検証していれば App Server へ無効 model が到達しないこと。

### フォールバック

- `model/list` 失敗・timeout・unsupported method → `GET /api/codex/models` が `available: false`、turn では model 省略。

### 永続化 / lifecycle

- 新規会話 + model 選択 → `thread/start` に model が含まれる。
- resume → 同一 `codexThreadId`、安全設定再適用、選択 model が `turn/start` に反映。
- ターン間 model 変更 → 次 `turn/start` のみ新 model、履歴 marker が維持される（統合テスト fixture）。
- `thread/delete` は会話削除時 best-effort（既存契約）。

### 安全 / MCP / proposal（Task 139 必須。Task 138 live では未実行）

- model 変更後も broker cwd、read-only sandbox、`approvalPolicy: never`、network `false` が維持される（自動化 / 統合テスト）。
- MCP inventory に Ghostwriter server のみ。proposal Apply 前 workspace 不変（既存 Task 129 系テストと併走）。
- Task 138 は上記を live 再実行していない。`codex-app-server-preflight.md` 継承契約の回帰防止として Task 139 でカバーする。

### プラン / workspace fixture

- Plus inventory fixture（本検証スナップショット）。
- Enterprise workspace 制限 fixture（公式 doc ベースの合成。live 未検証）。
- inventory 空配列 → picker 非表示。

### エラー表示

- 無効 model turn 失敗 → raw HTTP body を UI に出さず分類表示。
- rate limit snapshot → per-model 利用可と誤表示しない。

---

## 10. Unknowns and revalidation triggers（未検証事項・再検証トリガ）

### 未検証

| 項目 | 影響 |
|---|---|
| ChatGPT Free / Go / Pro / Team / Enterprise の inventory 差 | picker 候補と既定 model |
| Enterprise workspace model policy（[公式](https://learn.chatgpt.com/docs/enterprise/workspace-model-availability.md)） | 組織単位のフィルタ |
| Windows / x64 の同梱 CLI `model/list` | リリース判定 |
| 実行可能な外部 CLI（0.144.2 相当） | `chatgpt-bundled` 以外の source |
| `model/list` の実ページネーション（`nextCursor` 非 null） | decoder とキャッシュ |
| `includeHidden: true` | 隠し model の扱い |
| reasoning effort 変更と model 選択の相互作用 | UI 複雑度 |
| per-model rate limit / quota の可否 | inventory と実行時エラーの関係 |
| 長文・日本語小説での model 切替 eval | 品質・回帰 |

### 再検証トリガ

- ChatGPT.app / 同梱 CLI のメジャーアップデート
- `model/list` が `capabilities.experimentalApi` なしで失敗するようになる、または schema が破壊的に変更される
- 新プラン・workspace ポリシー対応宣言
- `thread/start` / `turn/start` の model 契約変更
- Ghostwriter が external CLI source をサポートすると判断したとき
- picker 実装後の本番障害（inventory stale、大量 unsupported model エラー）

---

## 11. Proposed Task 139（実装タスク案 — ファイルは作成しない）

**タイトル（案）:** `139 Codex model picker とサーバー側動的 allowlist を実装する`

**スコープ（案）:**

- `model/list` strict decoder と inventory キャッシュ（TTL・fail-closed）
- `GET /api/codex/models` と会話単位 `selectedCodexModel` 永続化
- `thread/start` / `turn/start` 送信前 allowlist 検証
- 会話 UI の model picker（inventory 不可用時は非表示）
- `specs/novel-editor-mvp.md` の Codex model picker 記述を実装に合わせて更新
- §9 の提案テストを Vitest / 必要なら Playwright で追加
- `codex-app-server-preflight.md` との重複を避け、本書を model 専用 SoT とする

**対象外（案）:** CLI 自動 install、外部 launcher 修復、別 provider fallback、reasoning effort picker（別タスク）

---

## Go / No-Go

| 項目 | 判定 |
|---|---|
| Decision | **Go（条件付き）** — 動的 allowlist・サーバー検証・失敗時既定 model フォールバック付き picker の実装タスク 139 へ進行可能 |
| Blocking issue | なし（Plus + 同梱 0.144.2 で inventory・model 変更・履歴連続性を確認） |
| 条件 | クライアント任意 model・inventory の quota 証明・`thread/start` 成功の信用をしないこと |
| MVP | 本タスクでは未更新。139 で更新 |
