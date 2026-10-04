# チャット自動Applyはターン終了より前に別プロセスでも実行される

## When this matters

チャットの編集案保存、原稿との整合性、proposal ID、会話への結果追記を変更するとき。

## Field note

`agentChatRunPersistence.ts`だけを見ると、会話への結果保存時に初めて原稿を変更するように見える。しかし実際のチャットでは`editProposalAutoApply.ts`がtool実行中にApplyする。後続toolが新規ディレクトリや編集済み本文を読めるのはこのためである。

さらにCodex MCP stdio workerはsidecarと別プロセスで起動する。会話保存にprocess内のMapによるキューだけを導入しても、MCPの自動ApplyとHTTP metadata更新の競合を保護できない。

従来のaccumulatorはproposal IDをtoolCallIdへ置換していた。tool実行中に先行保存する方式では、この置換を続けると同一proposalが履歴へ二重追加される。`persistedProposalId`を引き継ぎ、ターン終了時はassistantとの関連付けだけ補うことで、先行保存のIDと状態を維持できる。

クライアントの手動Apply通知だけを接続しても、自動ApplyとUndoはその経路を通らない。応答で新たに `applied` になったproposalとUndo成功をそれぞれ通知する必要がある。エディターのセッションはモードを越えて保持されるため、現在選択中のpathだけを通知先にすると、非選択タブの古い本文が残る。

## Reliable procedure

1. APIのApplyだけでなく、Vercel tool services、添付配置、Codex MCP bindingから自動Applyまで追う。
2. 保存済みIDがtool outputからaccumulatorと結果保存まで保持されることを確認する。過去のtoolCallId形式の履歴も別に確認する。
3. 単一processの並行テストに加え、別Bun processで同じ履歴へ追記する。原稿変更後にprocessを終了するテストでは、JSON内のsnapshotと残存ロックを直接確認する。
4. 復旧手順・保証範囲は仕様書の「会話保存の競合・中断と復旧」を正本とする。

## Failure signals

- Apply済み原稿はあるのに、assistant応答が失われると編集案も消える。
- 同じ編集が異なるproposal IDで複数表示される。
- HTTPだけの並行テストは通るが、Codex利用中にmetadataやsnapshotが消える。

## Recheck when

MCP workerの起動方式、binding identity、tool output schema、accumulator、Apply/Undoの副作用境界を変えるとき。
