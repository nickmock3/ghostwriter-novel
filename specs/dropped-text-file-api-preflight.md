# ドロップテキストファイル API契約

現行のチャット添付・ファイルimport契約。実装済みであり、以下の制約を維持する。

## 1. Context

- Integration target: Ghostwriter内部HTTP API、Vercel AI SDK tool
- Use case:
  - チャットへドロップしたテキストを一時保管し、AIが決めたworkspace相対pathへ原文のまま配置する。
  - エディットモードのファイルツリーへドロップしたテキストを、指定した兄弟順で新規ファイルとして追加する。
- Owner: Ghostwriter
- Date: 2026-07-23

## 2. Source of Truth

| Priority | Source | Path | Notes |
| --- | --- | --- | --- |
| 1 | 製品仕様 | `specs/novel-editor-mvp.md` | workspace境界、テキスト判定、会話、AI tool、チャット自動適用 |
| 2 | チャット契約 | `src/features/ai-chat/droppedTextFileContracts.ts` | 添付schema・上限・原文検証 |
| 2 | 一時保存 | `src/features/ai-chat/droppedTextFiles.ts` | opaque ID、staging、cleanup |
| 2 | ファイルimport | `src/features/file-tree/droppedFileImportApi.ts` | import入力・順序・レスポンス |

外部API連携ではないため、OpenAPIまたは外部SDK文書は存在しない。上記のリポジトリ内契約を正とし、テストで固定する。

## 3. Endpoint Contract

### `POST /api/chat/messages`

既存bodyへ`droppedTextFiles`を追加する。既存fieldと認証・stream responseは変更しない。

| Location | Field | Required | Type | Nullable | Default | Conditional requirement |
| --- | --- | --- | --- | --- | --- | --- |
| body | `workspaceRoot` | yes | non-empty string | no | none | always |
| body | `content` | yes | non-empty string | no | none | always |
| body | `conversationId` | no | non-empty string | no | omitted | existing conversationへ追加するとき |
| body | `mode` | no | `"chat" \| "editor"` | no | omitted | `droppedTextFiles`がある場合は`"chat"`必須 |
| body | `droppedTextFiles` | no | array | no | `[]` | chat modeだけ |
| body | `droppedTextFiles[].name` | yes per item | basename string | no | none | itemがある場合 |
| body | `droppedTextFiles[].contentBase64` | yes per item | canonical Base64 string | no | none | itemがある場合 |

追加制約:

- 1リクエスト最大5件。
- 1件最大1 MiB（UTF-8 byte数）、合計最大2 MiB。
- 空内容はテキストファイルとして許可する。
- basenameは空、`.`、`..`、`/`、`\`、NULLを拒否する。
- `contentBase64`はcanonical Base64だけを受理し、decode後の実byte数で上限を判定する。
- decode後のbytesはfatal UTF-8 decode、NULL byte、UTF-8 encode round-trip一致を検証する。BOM、CRLFを含む有効なUTF-8 bytesは変換せず原文として保存する。
- MIME type、クライアント絶対pathは受け取らない。
- 添付があるのに`mode !== "chat"`の場合は400。

認証:

- Web版は既存same-origin境界、デスクトップ版は既存sidecar bearer token境界を利用する。追加の認証fieldは設けない。

レート制限:

- 外部API rate limitはない。件数・byte上限でresource利用を制限する。

冪等性:

- 非冪等。通常のチャット送信と同じくクライアントは自動再送しない。
- staging後にagent開始前で失敗した場合は、そのrequestが作成した一時ファイルをcleanupする。
- agentへ受理された後は既存のturn非再送規則を維持する。

### `POST /api/files/import`

1リクエストで1件の外部テキストファイルをworkspaceへ新規作成し、同じ親のファイル表示順へ挿入する。

| Location | Field | Required | Type | Nullable | Default | Conditional requirement |
| --- | --- | --- | --- | --- | --- | --- |
| body | `workspaceRoot` | yes | non-empty string | no | none | always |
| body | `parentPath` | yes | string | no | none | rootは空文字 |
| body | `name` | yes | basename string | no | none | always |
| body | `contentBase64` | yes | canonical Base64 string | no | none | always |
| body | `insertBeforePath` | no | workspace-relative file path | no | omitted | 行間の後側fileがある場合 |

追加制約:

- `contentBase64`はcanonical Base64だけを受理し、decode後の実byte数を最大1 MiBとする。
- decode後のbytesはfatal UTF-8 decode、NULL byte、UTF-8 encode round-trip一致を検証する。workspaceへは検証済みの元bytesを書き込み、改行やBOMを変換しない。
- `parentPath`と`insertBeforePath`は共通workspace path境界で正規化する。
- `insertBeforePath`は存在するfileで、`parentPath`の直下にある兄弟でなければ409。
- 作成pathは`parentPath + name`からserver側で構成する。クライアント絶対pathは受け取らない。
- 既存fileまたはdirectoryと衝突する場合は409。上書き・自動renameはしない。
- filter中またはtree省略中のdrop禁止はclient側UI契約とし、serverは常に完全な兄弟集合で`insertBeforePath`を再検証する。

成功response:

- status: 200
- body:
  - `operation: "import"`
  - `path: string`
  - `parentPath: string`
  - `orderedFilePaths: string[]`

認証:

- 既存のsame-originまたはsidecar bearer token境界。

レート制限:

- 外部rate limitなし。1リクエスト1件、1 MiB上限。

冪等性:

- 非冪等。同じrequestの再送は既存path conflictとして409。

## 4. AI Tool Contract

### `ReadDroppedTextFile`

| Field | Required | Type | Nullable |
| --- | --- | --- | --- |
| `droppedFileId` | yes | UUID相当のopaque string | no |

- server-side run contextに登録された今回のworkspace・conversation・requestのIDだけを解決する。
- 成功時は`name`、`content`、`truncated`、`totalLines`を返す。
- contentは最大2000行。絶対pathは返さない。
- 読み取り専用、冪等。

### `PlaceDroppedTextFile`

| Field | Required | Type | Nullable |
| --- | --- | --- | --- |
| `droppedFileId` | yes | UUID相当のopaque string | no |
| `targetPath` | yes | workspace-relative path | no |

- tool入力からworkspace root、本文、元file pathを受け取らない。
- run contextの一時原文から既存Create proposal serviceへ渡す。
- chat modeの自動適用・Undoへ合流し、既存pathはconflictにする。
- 同じIDの配置成功後の再利用は拒否する。
- 非冪等。


## 5. Response and Error Contract

| Status | Message | Retryable | Notes |
| --- | --- | --- | --- |
| 400 | 安全化済み`message` | no | schema、mode、basename、NULL、path不正 |
| 404 | 安全化済み`message` | no | unknown/expired droppedFileId |
| 409 | 安全化済み`message` | user action | file conflict、兄弟位置不整合、使用済みID |
| 413 | 安全化済み`message` | user action | 件数・file size・合計size超過 |
| 500 | `Application data storage is unavailable`または安全化済みmessage | yes | dataRootまたはworkspace I/O失敗 |

- raw path、stack、token、prompt、本文全文をerrorへ含めない。
- 複数チャット添付の個別状態は専用のstream eventで処理中、配置済み、未配置、失敗として表示する。HTTP request自体のvalidationは全件をstageする前に行い、schema/size失敗時は全体を拒否する。

## 6. Ambiguities and Resolution

| Topic | Resolution | Evidence |
| --- | --- | --- |
| チャットの一時保存先 | workspace内`temp/`ではなく`{dataRoot}/dropped-text-files/...` | ユーザーは「tempなど」を許容し、タスク175はworkspace汚染とpath露出を避ける |
| チャットUI | 全面チャットのcomposer添付。左ペインは追加しない | ユーザー明示 |
| AIによる配置 | modelが本文を再生成せず専用toolが原文をcopyする | タスク175の原文非変質要件 |
| ファイルツリー順序 | `{dataRoot}`のworkspace別UI metadataへ保存 | filesystemに兄弟表示順がなく、workspaceへ隠し管理fileを置かないため |
| 複数tree drop | clientが1件ずつAPIを順番に呼び、成功分を表示する | partial failureを明示し、server rollbackを複雑化しないため |
| 文字コード | ブラウザーは元bytesをcanonical Base64で送り、サーバーでstrict UTF-8 decodeとround-tripを検証する | client decode後のJSON文字列だけでは元bytes・置換有無・配置後のbyte一致をserverが保証できないため |

## 7. Validation and Contract Tests

- `POST /api/chat/messages`
  - 添付なしの既存最小bodyが成功する。
  - chat modeで1件の空または通常textが成功する。
  - mode欠落/editor、6件、1件超過、合計超過、非canonical Base64、invalid UTF-8、NULL、path separatorを拒否する。
  - staging失敗時にagentを開始せずcleanupする。
- `POST /api/files/import`
  - rootとnested parentへ1件作成できる。
  - `A, B`に`insertBeforePath=B`で`C`を追加し`A, C, B`を返す。
  - 必須欠落、null、型不一致、非canonical Base64、invalid UTF-8、path traversal、hidden segment、別parentのbefore、既存path、size超過を拒否する。
  - BOM、CRLF、日本語を含む有効なUTF-8について、受信bytesと配置後bytesが一致する。
- AI tools
  - 同一run IDのread/placeが成功する。
  - 別workspace、別conversation、別run、unknown、expired、使用済みを拒否する。
  - readは2000行でtruncateする。
  - placeは原文一致のCreate proposalを作成し、chat auto-apply/Undoへ合流する。

## 8. 実装と検証の配置

上記の契約は実装済み。Zod schemaと近接するcontract/API/serviceテストで保証する。API handlerは薄くし、staging、順序、workspace作成はfeature serviceへ委譲する。
