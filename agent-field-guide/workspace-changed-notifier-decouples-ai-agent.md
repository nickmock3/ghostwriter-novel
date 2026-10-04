# ワークスペース変更通知でai-agentへの逆依存を切る

## When this matters

file-tree / workspace などインフラ寄りのfeatureが、AI側の構造コンテキストキャッシュ無効化など ai-agent 実装詳細を直接 import しそうなとき。

## Field note

ワークスペース構造が変わった事実だけを薄い notifier（`notify` / `subscribe`）として `src/features/workspace/` に置き、ai-agent 側が購読してキャッシュを落とす。producer は「誰が聴いているか」を知らない。

`src/shared/` より workspace feature の方が依存方向が健全になりやすい。workspace は既に file-tree / ai-agent の共通基盤であり、通知対象もワークスペース変更だからである。

## Reliable procedure

1. `workspaceChangedNotifier` のような AI 知識を持たない notify/subscribe を追加する。
2. ファイル作成・削除・改名・import・テンプレート適用などの成功後は `notifyWorkspaceChanged(workspaceRoot)` だけを呼ぶ。
3. `workspaceStructureContext` はモジュールロード時に subscribe し、`invalidateWorkspaceStructureContext` へ接続する。
4. file-tree / workspace のソースに `ai-agent` import が残っていないことをテストで固定する。

## Failure signals

- file-tree / workspace から `../ai-agent/` を直接 import している。
- ファイル操作後も AI の構造サマリが古い（購読未登録、または notify 漏れ）。
- notifier を shared に置き、workspace ドメインの関心が横断インフラへ漏れている。

## Recheck when

新しいファイル操作経路や AI 以外のワークスペース変更リスナーを追加するとき。
