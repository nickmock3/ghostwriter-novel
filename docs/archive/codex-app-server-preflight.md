# Codex App Server連携 preflight

> 廃止済みの調査記録。タスク231で旧Codex CLI連携を撤去したため、以下は現行製品の仕様・実装要件ではない。

## 1. Context

- Integration target: ChatGPTデスクトップアプリ同梱またはユーザーが別途インストールしたCodex CLI `app-server`
- Use case: Ghostwriterの任意AI実行方式として、ChatGPTログイン済みCodexからGhostwriter管理MCP toolを呼び出す
- Owner: Ghostwriter
- Date: 2026-07-11
- Verified external CLI version: `codex-cli 0.144.1`
- Verified ChatGPT.app bundled CLI version: `codex-cli 0.144.0-alpha.4`（`initialize` smoke、2026-07-12）
- Verified ChatGPT.app bundled CLI version: `codex-cli 0.144.2`（生成`v2/ThreadStartResponse`、2026-07-15）
- Verified ChatGPT.app bundled CLI version: `codex-cli 0.145.0-alpha.18`（生成`v2/ThreadResumeResponse`、2026-07-20）

この文書はproduction実装前の契約を固定する。検証用スクリプトは実ワークスペースを渡さず、固定markerを返す読み取り専用toolだけを公開する。

## 2. Source of Truth

優先順位は、実レスポンス、対象CLIが生成したschema、公式ドキュメント、npmパッケージ情報の順とする。

| Priority | Source | URL / path | Version / date | Notes |
|---:|---|---|---|---|
| 1 | 実レスポンス | 本文「Observed responses」 | CLI 0.144.1 / 2026-07-11 | stdioで直接観測。tokenは記録しない |
| 2 | App Server生成JSON Schema / TypeScript | `codex app-server generate-json-schema --experimental`, `generate-ts --experimental` | CLI 0.144.1 / 0.144.2 | 必須、nullable、enumの判定に使用。一時ディレクトリへ生成しリポジトリには保存しない |
| 3 | OpenAI公式App Server docs | https://developers.openai.com/codex/app-server | 2026-07-11参照 | lifecycle、認証、thread/turn、event、MCPの説明 |
| 4 | OpenAI公式Codex auth docs | https://developers.openai.com/codex/auth | 2026-07-11参照 | ChatGPTログインとAPI key課金の区別 |
| 5 | npm package metadata | `@openai/codex`, `@openai/codex-sdk` | 0.144.1 | 対応platformとSDKがCLIを起動する事実の確認に限定 |

### 既知の差分

- 公式例では`initialize.clientInfo.title`を送っているが、0.144.1生成schemaで必須なのは`name`と`version`だけで、`title`はnullable/optionalである。Ghostwriterは表示品質のためtitleも送るが、decoderは欠落を許容する。
- 公式例では`account/read`へ`refreshToken: false`を渡すが、0.144.1生成型ではoptionalである。通常の状態確認は空objectを送り、明示refresh時だけbooleanを送る。
- `thread/start`はprotocol上すべてoptionalだが、Ghostwriterは安全方針としてbroker cwd、`sandbox: "read-only"`、`approvalPolicy: "never"`を必須化する。
- `0.145.0-alpha.18`の`thread/resume`は従来の応答に加え、nullableな`turnsBackwardsCursor`と`itemsBackwardsCursor`を返す。Ghostwriterはページネーションを利用せず、両fieldを明示許可して破棄する。
- GhostwriterがApp Serverへ送るrequest params、MCP tool input、sandbox・approval policy・network access・broker cwd・workspace bindingはstrictに検証し、未知値・欠落・型不一致をfail closedとする。一方、App Serverから受けるaccount、rate-limit、表示用metadataのsuccess responseとnotificationは、利用する既知fieldの必須性・型を検証した上で、安全性に影響しない追加fieldをstripしてdomain/UIへ渡さない。JSON-RPC error、必須field欠落、既知fieldの型不一致は受理しない。

## 3. Transport contract

- Transport: stdio、1行1 JSON-RPC message
- Process: Ghostwriter sidecarが解決済みCodex実行ファイルを`spawn`し、shellを介さない
- Authentication: App Serverの`account/login/start`によるChatGPT loginだけをCodex backendとして許可する
- API key login: GhostwriterのCodex backendでは提供しない
- Pagination: `mcpServerStatus/list`だけcursor/limitを持つ。最小検証は1 pageだけ読む
- Rate limit: `account/rateLimits/read`のsnapshotを表示用に扱う。自動でreset creditを消費しない
- Idempotency: protocolにidempotency keyはない。request IDは同一connection内で一意にする
- Time: `resetsAt`等はUnix seconds。UI変換時にローカルtimezoneへ変換する

## 4. Endpoint contracts

App ServerはHTTP endpointではなくJSON-RPC methodを使う。表の「Required」は0.144.1生成schema上の必須を表し、Ghostwriter policy上の追加必須はConditionalへ記載する。

### `initialize`

| Location | Field | Required | Type | Nullable | Default | Conditional |
|---|---|---:|---|---:|---|---|
| params | `clientInfo` | yes | object | no | - | - |
| params.clientInfo | `name` | yes | string | no | - | 空文字をGhostwriter側で拒否 |
| params.clientInfo | `version` | yes | string | no | - | Ghostwriter app versionを渡す |
| params.clientInfo | `title` | no | string | yes | omitted | Ghostwriterは固定titleを送る |
| params | `capabilities` | generated TSではyes | object | yes | - | experimental APIはproduction既定false |

Success result required: `userAgent`, absolute `codexHome`, `platformFamily`, `platformOs`。安全性に影響しない追加metadataはstripし、初期化失敗として扱わない。

### `initialized`

paramsなしのnotification。`initialize`成功後に1回だけ送る。responseはない。

### `account/read`

| Location | Field | Required | Type | Nullable | Default | Conditional |
|---|---|---:|---|---:|---|---|
| params | `refreshToken` | no | boolean | no | false相当 | 明示refresh時だけtrue |

Success result required: `requiresOpenaiAuth: boolean`。`account`はnullableで、既知typeは`apiKey`, `chatgpt`, `amazonBedrock`。GhostwriterのCodex ready状態は`account.type === "chatgpt"`だけとする。未知typeはaccount identityを誤認しないようdecoder errorとして扱う。安全性に影響しない追加response fieldはstripし、account domainへ透過させない。

ChatGPT accountの`email`はnullable、`planType`の既知enumは`free`, `go`, `plus`, `pro`, `prolite`, `team`, `self_serve_business_usage_based`, `business`, `enterprise_cbp_usage_based`, `enterprise`, `edu`, `unknown`。未知の将来値は表示上`unknown`へ正規化する。

### `mcpServerStatus/list`

| Location | Field | Required | Type | Nullable | Default | Conditional |
|---|---|---:|---|---:|---|---|
| params | `cursor` | no | string | yes | null | 次page取得時だけ |
| params | `limit` | no | uint32 | yes | server-defined | 0は許容されるためGhostwriterは1以上へ制限 |
| params | `detail` | no | enum | yes | `full` | `full` / `toolsAndAuthOnly` |
| params | `threadId` | no | string | yes | null | thread-scoped inventory時だけ |

Success result required: `data: array`。`nextCursor`はnullable。`authStatus`は現行の`unknown`を含む将来のstring値を表示用metadataとして受理し、ready判定には使わない。response、server、tool、resource、resource template、server infoの安全性に影響しない追加fieldはstripする。検証では`ghostwriter_preflight` serverと`ghostwriter_echo` toolがinventoryへ現れることを確認し、production readinessでは`ghostwriter` serverと必須の`Read` toolが欠けていればfail closedとする。

### `model/list`

paramsの`cursor`はnullable、`includeHidden`はboolean、`limit`は正の整数として送信時にstrictに検証する。Success resultでは`data: array`を必須、`nextCursor`をnullable/optionalとして扱う。各modelの`id`, `model`, `displayName`, `description`, `hidden`, `isDefault`は必須かつ型一致を要求する。

model本体、`supportedReasoningEfforts`、`serviceTiers`、`availabilityNux`、`upgradeInfo`、page top-levelに追加された安全性に影響しないmetadataはstripし、公開inventoryへ渡さない。公開inventoryは既知の表示fieldだけへ正規化し、hidden modelを除外し、可視modelが1件以上かつ既定modelがちょうど1件であることをfail closedで検証する。会話で指定できるmodelは、この認証済み動的inventoryに含まれる値だけとする。

### `thread/start`

Protocol上のfieldはすべてoptional。Ghostwriterは次を送信時必須にする。

| Location | Field | Required by Ghostwriter | Type | Nullable | Value / rule |
|---|---|---:|---|---:|---|
| params | `cwd` | yes | absolute path | no | source repo・小説workspace外の空broker directory。小説workspaceを渡さない |
| params | `sandbox` | yes | enum | no | `read-only` |
| params | `approvalPolicy` | yes | enum | no | `never`。書き込み承認はGhostwriter tool側が管理 |
| params | `developerInstructions` | yes | string | no | app固定安全指示、現在mode用のCodex役割指示、現在workspace直下の検証済み`AGENTS.md`の順で合成。下位指示から上位指示を上書き不可 |
| params | `serviceName` | yes | string | no | `ghostwriter` |
| params | `model` | no | string | yes | 未指定時はCodex側default。利用可能model inventoryからのみ選択 |
| params | `ephemeral` | no | boolean | yes | smokeではtrue、production会話ではfalse |

`permissions`と`sandbox`は同時に送らない。Success resultでは`thread.id`, `cwd`, `model`, `modelProvider`, `approvalPolicy`, `sandbox`を必須としてdecodeする。0.144.2生成schemaでは`thread.path`と`thread.recencyAt`はoptionalかつnullableであり、0.144.1のephemeral `thread/start`実レスポンスでも`path: null`を確認済み。Ghostwriterはこれらを正規化に使わず、安全性に影響しないtop-level・thread・status metadataはstripする。`approvalPolicy`, `sandbox`, `networkAccess`, `cwd`など既知の安全性fieldの欠落・型不一致・未知値・安全でない値はfail closedとする。

### `turn/start`

| Location | Field | Required | Type | Nullable | Rule |
|---|---|---:|---|---:|---|
| params | `threadId` | yes | string | no | `thread/start`のresultから取得 |
| params | `input` | yes | array | no | Ghostwriterは1件以上に制限 |
| params.input[] | `type` | yes | enum | no | smokeは`text`だけ |
| params.input[] | `text` | text時yes | string | no | 空文字を拒否 |

Success result required: `turn`。完了判定はrequest responseではなく`turn/completed` notificationを正とする。MCP tool接続成功は`item/started`または`item/completed`の`mcpToolCall` itemでserver/toolとresult markerを確認する。turn response、`turn/completed`、item lifecycle、token usage notificationの安全な追加metadataはstripし、既知fieldの処理を継続する。turn/thread ID不一致、status欠落・型不一致は受理しない。未知の`codexErrorInfo`を含むfailed turnは通知を破棄してtimeoutさせず、raw message、追加詳細、payloadを含まない汎用エラーへ正規化する。

### `thread/resume`

| Location | Field | Required | Type | Nullable | Rule |
|---|---|---:|---|---:|---|
| params | `threadId` | yes | string | no | Ghostwriterがserver-side conversation metadataから取得する |
| params | `history` | no | ResponseItem[] | yes | unstableのため使用しない |
| params | `path` | no | string | yes | rollout pathをauthorityにしないため使用しない |
| params | `cwd` | no | absolute path | yes | broker cwdを再適用する |
| params | `approvalPolicy` | no | enum | yes | `never`を再適用する |
| params | `sandbox` | no | enum | yes | `read-only`を再適用する |
| params | `developerInstructions` | no | string | yes | app固定安全指示、現在mode用役割指示、現在workspaceの合成済み指示を再適用する。以前のmodeまたはworkspace指示を再利用しない |

Success result required: `thread.id`、`model`、`modelProvider`、`cwd`、`approvalPolicy`、`sandbox`。安全性に影響しないtop-level・thread・status metadataはstripする。保存済みIDが欠損・不整合なら自動resumeを繰り返さず、新しいthreadを1回だけ開始してGhostwriter履歴から再構築する。

### `thread/read`

| Location | Field | Required | Type | Nullable | Rule |
|---|---|---:|---|---:|---|
| params | `threadId` | yes | string | no | server-side conversation metadataから取得する |
| params | `includeTurns` | no | boolean | no | lifecycle検証ではfalseまたは省略 |

Success result required: `thread`。安全性に影響しない追加metadataはstripする。Codex rollout本文をGhostwriterの第2履歴として表示・保存しない。

### `thread/delete`

| Location | Field | Required | Type | Nullable | Rule |
|---|---|---:|---|---:|---|
| params | `threadId` | yes | string | no | server-side conversation metadataから取得する |

Success result is an empty object. Failure is best-effort and must not block deletion of the Ghostwriter conversation; diagnostics retain only method and sanitized error kind.

### `account/rateLimits/read`

paramsなし。Success result required: `rateLimits`。`rateLimitsByLimitId`と`rateLimitResetCredits`はnullable。`primary`, `secondary`, `resetsAt`, `rateLimitReachedType`もnullableとして扱う。`spendControlReached`のようなboolean metadataと安全性に影響しない追加fieldは検証後にstripする。`rateLimitReachedType`は将来の非null stringも受理し、Ghostwriterの表示用domainでは利用枠到達として安全側に扱う。429相当や利用枠到達時に別providerへ自動fallbackしない。

## 5. MCP smoke tool contract

Server name: `ghostwriter_preflight`
Tool name: `ghostwriter_echo`

Input JSON Schema:

```json
{
  "type": "object",
  "properties": { "value": { "type": "string" } },
  "required": ["value"],
  "additionalProperties": false
}
```

`value`は空でない文字列、余分なfieldは拒否する。toolはread-only annotationを持ち、ファイル、ネットワーク、認証情報へアクセスしない。成功時はtext contentとstructured contentの両方に固定marker `GHOSTWRITER_CODEX_MCP_SMOKE_OK`と入力値を返す。validation errorはMCP error resultとして返し、プロセスを終了しない。

## 6. Error contract

App Server transport errorはJSON-RPC errorとnotification内のCodex errorに分ける。

| Source | Code / status | Retryable | Ghostwriter handling |
|---|---|---:|---|
| JSON-RPC | `-32700` parse error | no | protocol failureとしてprocessを再起動 |
| JSON-RPC | `-32600` invalid request | no | client bug。sanitized log |
| JSON-RPC | `-32601` method not found | no | unsupported CLI version/capability |
| JSON-RPC | `-32602` invalid params | no | DTO/schema mismatch。自動再試行しない |
| JSON-RPC | server error | conditional | error dataを表示せず分類して判断 |
| Codex | `unauthorized` | after login only | login UIへ遷移 |
| Codex | `usageLimitExceeded` | no until reset | rate-limited表示 |
| Codex | `serverOverloaded`, connection failures | yes, bounded | 最大1回のprocess/turn再試行 |
| Codex | `badRequest`, `contextWindowExceeded`, `sandboxError` | no | ユーザー向け分類エラー |
| Process | executable missing / ENOENT | no | not-installed |
| Process | shim exists but child binary missing | no | invalid-installation |
| Process | version below minimum | no | unsupported-version |

raw stderr、access token、authorization header、prompt、原稿本文は通常ログへ保存しない。

## 7. Boundary validation and contract tests

- JSON-RPC DTOをZodなどのdecoderで検証してからdomain eventへ変換する。
- 未知notificationは無視してよいが、未知response shapeは該当requestを失敗させる。
- 未知enumはaccount planでは`unknown`へ正規化し、MCP auth statusなどready判定に使わない表示用fieldでは未知stringを受理して破棄し、安全性に関わるsandbox/approval enumではfail closedとする。
- Codex executable pathはserver-side設定からだけ解決し、client request、workspace、会話から任意引数を追加できない。
- `codex --version`の終了成功と出力parseに加え、App Server `initialize`成功までをinstallation health checkとする。

Contract tests:

- 正常: `codex-cli 0.144.1`をversionとしてparseできる。
- 異常: PATH shimが存在しても実体起動失敗出力をversionとして受理しない。
- 正常: MCP `tools/list`が固定read-only toolを返す。
- 正常: `tools/call`が入力値とmarkerを返す。
- 異常: tool input必須欠落、型不一致、null、未知fieldを拒否する。
- 異常: 未知MCP methodへJSON-RPC `-32601`を返す。
- Live: App Server initializeと`account/read`をdecodeできる。
- Live: MCP inventoryにserver/toolが現れる。
- Live: model turnがtoolを呼び、eventまたは最終応答でmarkerを確認できる。
- 正常: `thread/resume`、`thread/read`、`thread/delete`の最小必須paramsとresponseをdecodeできる。
- 異常: lifecycle methodの`threadId`欠落、null、型不一致を拒否する。

## 8. Observed responses

CLI 0.144.1を一時`CODEX_HOME`、stdio、`--strict-config`で起動して観測した。識別子は記録せず、shapeだけを残す。

```json
{
  "id": 1,
  "result": {
    "userAgent": "Codex Desktop/0.144.1 (...) (ghostwriter-preflight; 0.1.0)",
    "codexHome": "/private/tmp/...",
    "platformFamily": "unix",
    "platformOs": "macos"
  }
}
```

```json
{
  "id": 2,
  "result": {
    "account": null,
    "requiresOpenaiAuth": true
  }
}
```

これはisolated `CODEX_HOME`で未認証状態を正しく判定できる証跡である。

### MCP live smoke

同じCLI 0.144.1で、次の条件によりlive smokeを実行した。

- App Server binaryはnpmの一時cacheに取得した外部CLIを使い、Ghostwriterへ同梱していない。
- 専用`CODEX_HOME`相当の一時directoryを作り、検証時だけ既存のChatGPT認証fileをsymlink参照した。token本文は読まず、出力・fixture・repositoryへ保存していない。productionではsymlinkや認証共有を使わず、Ghostwriter専用homeで別途loginする。
- `apps`, `plugins`, `remote_plugin`, `plugin_sharing`を無効化し、MCP inventoryを`ghostwriter_preflight`だけに限定した。
- thread `cwd`は空の一時broker directory、`sandbox: "read-only"`、`approvalPolicy: "never"`、network disabled、ephemeral threadとした。
- 小説workspace、repository path、原稿、API keyをturnへ渡していない。

観測結果:

1. `initialize`が成功し、CLI version、専用`codexHome`、platformを取得できた。
2. `account/read`がChatGPT accountとsubscription planを返し、API key loginではないことを判定できた。emailは検証ログ以外へ転記しない。
3. `mcpServerStatus/list`に`ghostwriter_preflight`とread-only `ghostwriter_echo`だけが現れた。
4. `thread/start` resultがbroker cwd、`approvalPolicy: "never"`、`sandbox.type: "readOnly"`、`networkAccess: false`を返した。
5. `turn/start`後、`item/started` / `item/completed`の`mcpToolCall`がserver `ghostwriter_preflight`、tool `ghostwriter_echo`、指定した固定検証値を示した。
6. completed tool resultのtextとstructured contentに`GHOSTWRITER_CODEX_MCP_SMOKE_OK`が含まれた。
7. final agent messageもmarkerと検証値を返し、turnは`completed`になった。
8. `thread/tokenUsage/updated`と`account/rateLimits/updated`を別eventとして受信できた。

初回inventoryでは、tool専用serverにも`resources/list`と`resources/templates/list`が呼ばれることを確認した。検証serverは両methodへ空一覧を返すよう修正し、method-not-found警告を避ける契約テストを追加した。

再現時は外部CLIへ次の設定を渡し、`scripts/codex-app-server-mcp-smoke.ts --mcp-server`をstdio MCP serverとして起動する。実行ファイルpathは環境に合わせる。

```text
codex app-server --stdio --strict-config \
  --disable apps --disable plugins --disable remote_plugin --disable plugin_sharing \
  -c 'mcp_servers.ghostwriter_preflight.command="<bun-path>"' \
  -c 'mcp_servers.ghostwriter_preflight.args=["run","<repo>/scripts/codex-app-server-mcp-smoke.ts","--mcp-server"]'
```

検証では`initialize`、`initialized`、`account/read`、`mcpServerStatus/list`、`thread/start`、`turn/start`の順に送信し、MCP itemと`turn/completed`を確認する。認証済み通常homeを直接使うと個人plugin/MCPも読み込まれるため、production検証では必ず専用homeを使う。

### ChatGPT.app同梱CLI 0.144.0-alpha.4互換確認

- `thread/start` / `thread/resume`のtop-level field分離をadapterで基準契約へ正規化し、安全性fieldは基準版と同じくfail closedで検証する。
- `thread/resume`の`thread`は`id`だけの最小variantに加え、`turns`、`status`、`cliVersion`など生成schema由来の既知fieldを持つ詳細variantを返す。両variantで利用する既知fieldを検証し、安全性に影響しない未知nested metadataはstripする。
- `turn/completed`の`turn.error`は正常完了時に`null`を取り得る。省略だけを許可すると通知を破棄してtimeoutするため、生成schemaで既知の`null`または`TurnError`を明示検証する。
- production runtimeも`mcpServerStatus/list`で`ghostwriter` serverと`Read` toolを確認してからthreadを開始する。実機inventoryでは7 toolsを確認した。
- 認証済み実機でturn完了と解決model `gpt-5.6-sol`、provider `openai`を確認した。production `ghostwriter` MCPの`Read`について`item/started` / `item/completed`、固定markerを含むtool result、final agent messageまでround-tripに成功した。
- 同梱版item lifecycle notificationの既知`startedAtMs` / `completedAtMs`を検証して正規化し、安全な追加metadataはstripする。MCP subprocessにはworkspace pathではなくGhostwriterのdata rootだけを明示し、file bindingからturn単位のworkspaceを解決する。
- production MCPのproposal toolはworkspaceを直接変更しないため`readOnlyHint: true`、追加的かつclosed-worldなので`destructiveHint: false`、`openWorldHint: false`とする。Read系だけ`idempotentHint: true`、proposal系は`false`とする。`approvalPolicy: "never"`のまま、実機で`Read`直後の`Edit`、`Create`、`CreateDirectory`が承認拒否なしにpending proposalを作り、Apply前のworkspaceが不変であることを確認した。App Serverの限定approval処理は追加しない。
- macOS Apple Siliconのrelease `.app`に同梱したsidecarを`PATH=/usr/bin:/bin`で起動し、sidecar自身の`--mcp-server`分岐を使ったApp Server `initialize`が成功することを2026-07-13に確認した。health結果はsource `chatgpt-bundled`、絶対path `/Applications/ChatGPT.app/Contents/Resources/codex`、version `0.144.0-alpha.4`、handshake `ready`だった。

## 9. preflight後のproduction方針

検証済み契約を基に、production roadmapでは次の方針を固定する。

- 外部CLIの最低・検証済みversionは、schema生成とMCP live round-tripに使った`0.144.1`とする。ChatGPT.app同梱CLIの最低・検証済みversionは、実機`initialize`に成功した`0.144.0-alpha.4`とする。新しいversionはhandshake成功を必須とし、sourceごとの未検証version警告を表示する。
- Ghostwriterはアプリ単位の専用`CODEX_HOME`を1つ使い、通常のCodex認証やconfigをcopyまたはsymlinkしない。
- ChatGPT browser loginを既定、device-code loginを代替とし、API keyやexternal token loginを公開しない。
- 初期runtimeはCLIの既定modelで成立させた。Task 139以降は`docs/archive/codex-model-picker-preflight.md`を正として、認証済み`model/list`の動的allowlistに限定した会話単位model pickerを提供し、inventory不可時はmodel指定を省略してこの既定model動作へ戻す。
- runtime backendは最初のuser message後にGhostwriter会話へ固定し、切替時は新しい会話を作る。
- process再起動は最大1回とする。App Serverが受理したturn、またはtoolを開始したturnを自動再実行しない。
- productionはread-only段階と編集可能段階に分け、proposal tool登録より先にread-only MCPとchatを完成させる。

実装タスクは`tasks/open/`の`115`から`122`とし、CLI探索、protocol client、専用auth UI、read-only MCP、read-only runtime、thread永続化、編集proposal、release hardeningの順に進める。

## 10. Go / No-Go

- Decision: Go（production実装タスクを開始可能）
- Blocking issue: なし。App Server、ChatGPT subscription account、isolated MCP inventory、model turn、tool result、final responseのround-tripを確認済み
- Production implementationで継続確認する事項: macOS/WindowsのCLI探索、専用login UI、実workspace tool adapter、process再起動、conversation/thread復元、長文・日本語小説eval
- Non-goals confirmed: Codex同梱、API key login、workspace直接公開、experimental dynamic tools、別providerへの自動fallback
