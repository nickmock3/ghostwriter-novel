# Claudeのthinking署名はツール実行中のsystem prompt更新でも無効になる

## When this matters

Claudeの新モデルを追加するときや、エージェントがツール実行の途中でsystem promptを更新するとき。

## Field note

署名付きthinking blockをMessages APIへ再送したとき、Claudeはそのブロックの手前にあったsystem、ツール定義、会話履歴を検証する。同じユーザー入力に対する複数回のツール実行でも、スキルがsystem promptを書き換えると署名が無効になり得る。Claude Fable 5.2はprefix不一致で400を返す。Claude Sonnet 5.5とHaiku 5.5も条件によって400を返す。

## Reliable procedure

元のsystemと履歴を維持できる経路では、既存のthinking blockをそのまま再送する。systemの途中更新が仕様である経路では、Anthropic SDKのadaptive thinkingに`blockBinding.prefixMismatchBehavior: "drop_block"`を指定できる。偽fetchのツール結果付きリクエストで、署名が再送され、`thinking.type`が`adaptive`で、`thinking.block_binding.prefix_mismatch_behavior`と`anthropic-beta: thinking-binding-controls-2026-08-01`が揃うことを確認する。[ClaudeのAPI仕様](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks)

## Failure signals

最初の応答とツール呼び出しは成功し、systemを更新した後のリクエストでthinking blockが別会話に紐付いているという400が返る。

## Recheck when

Anthropic SDKのバージョン、対応Claudeモデル、スキルによるsystemの更新方法を変更するとき。
