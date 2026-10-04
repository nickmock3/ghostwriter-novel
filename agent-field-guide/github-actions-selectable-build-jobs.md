# GitHub Actionsで選択可能なビルドを分ける

## When this matters

`workflow_dispatch`のinputでmatrix内のplatform別buildを選択したいとき。

## Field note

job-levelの`if`はmatrix展開前に評価されるため、`jobs.<job>.if`で`matrix.*`を使ってplatformごとの実行を選別しない。選択対象が少数なら、targetごとに独立したjobを作り、それぞれをdispatch inputでgateする。

## Reliable procedure

1. dispatch inputの未選択を検証する軽量jobを先に置く。
2. targetごとに独立したbuild jobを置き、tag pushまたは対応inputをjob-level `if`で許可する。
3. artifactを消費するjobは、必要なtargetのbuild jobだけを`needs`へ指定する。
4. workflow契約テストで、input、tag条件、job依存、artifact名を固定する。

## Failure signals

- matrixの一部だけを選んだ手動実行で、不要なrunnerも起動する。
- `matrix` contextを含むjob-level条件が期待どおりに評価されない。
- artifact download jobが選択されなかったtargetを待機または参照する。

## Recheck when

GitHub Actionsのjob-level `if`とmatrix contextの評価順、またはworkflowをreusable workflowへ分割する構成が変わるとき。

## Related work

- task 186
