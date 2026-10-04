# アプリ内token保存はワークスペースのRead境界も保護する

## When this matters

OAuth tokenをローカルファイルへ保存し、同じアプリが任意のワークスペースをRead/Searchできる場合。

## Field note

owner-only権限でも同じBunプロセスのAI toolは読める。データrootを原稿rootの内部へ置く構成では、公開APIにtokenを直接返さなくても通常のファイルAPIやReadから到達し得る。hiddenファイルの「編集不可」やtreeからの非表示はread保護ではない。

## Reliable procedure

SIWCのprivateディレクトリを資格情報作成前に登録し、共通の`resolveWorkspaceRoot`でその親/子に当たるrootを拒否する。realpathでsymlink aliasを照合する。既定offの場合も、以前の資格情報ディレクトリが存在すれば保護を登録する。原稿とdataRootは別に配置する。

認証serviceだけでなく通常file APIを使う一時ディレクトリのテストで、秘密があるroot・その子・symlink aliasが拒否され、隣の原稿rootが使えることを確認する。

## Failure signals

認証APIのJSONにはtokenがなくても、`.data/siwc/credentials.json`をRead可能なら不十分。元のrootで認証をoffにすると資格情報が読める構成も避ける。

## Recheck when

資格情報の保存場所、workspace root検証、Searchの入口、別プロセス起動、OS資格情報ストアへの切替を変更するとき。
