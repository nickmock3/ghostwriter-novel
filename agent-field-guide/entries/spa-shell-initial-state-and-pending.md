# SPAシェルはlocalStorageなしの初期stateとpending表示で描画される

## When this matters

TanStack StartのSPAモード（`tanstackStart({ spa: { enabled: true } })`）で、起動・再読み込み直後に一瞬だけ別状態の画面（初回モーダル、「未選択」、空白）が見えるとき。localStorageから読む値でUIを分岐させるとき。

## Field note

返されるHTMLはサーバー側で描画したシェルで、`window.localStorage`は読めない。`useState(() => readFromLocalStorage())`のような初期値はシェルでは既定値になり、hydration完了までその画面が表示される。jsdomの結合テストは`createRoot`で描画しeffectも`act`内で流れるため、この一瞬の表示を検出できない。

ルートの`component`はシェルでは描画されず、`<Outlet />`はルートチャンク読み込み完了まで空になる。router既定の`defaultPendingMs`（1000ms）の間は何も出ない。`defaultPendingComponent`を`defaultPendingMs: 0`・`defaultPendingMinMs: 0`で設定すると、シェルHTMLにもpending表示が入る。pending表示はルートコンポーネント（App）の内側で描画されるため、Appのcontextを読める。

## Reliable procedure

1. `curl http://localhost:<port>/<path>`でシェルHTMLを取得し、`app-view-stack`などの中身に何が入っているかを確認する。
2. localStorageに依存する判定は、シェルとhydrationで一致する「未確定」状態を初期値にし、mount後のeffectで確定させる。未確定中は確定後のどちらの画面でもなく読み込み表示を出す。
3. Playwrightでは`addInitScript`でMutationObserverを`document`へ登録し、パーサーが挿入したシェルのノードも含めて、一度でも不要な画面が現れたかをフラグで記録して最後に確認する。APIは`page.route`で応答を保留して途中状態を作る。

## Failure signals

- `/editor`の再読み込みで初回モーダルが一瞬出るのに、Vitestでは再現しない。
- `/chat`や`/reader`の再読み込み直後、サイドバーだけが表示され本文領域が空白になる。

## Recheck when

TanStack Startのレンダリングモード（SPA/SSR）、routerのpending設定、code splitting設定を変えるとき。
