import { Link, createRouter, type RouterHistory } from "@tanstack/react-router";
import { ModeLoadingStatus } from "./app/ModeLoadingStatus";
import { routeTree } from "./routeTree.gen";

type GetRouterOptions = {
  history?: RouterHistory;
};

export function getRouter(options: GetRouterOptions = {}) {
  return createRouter({
    defaultNotFoundComponent: NotFoundComponent,
    // Show route chunk loading in the SPA shell immediately instead of a blank view.
    defaultPendingComponent: ModeLoadingStatus,
    defaultPendingMinMs: 0,
    defaultPendingMs: 0,
    history: options.history,
    routeTree,
    scrollRestoration: true,
  });
}

function NotFoundComponent() {
  return (
    <section className="not-found-page" aria-label="ページが見つかりません">
      <div className="not-found-panel">
        <h1>ページが見つかりません</h1>
        <p>指定された画面はこのアプリに存在しません。</p>
        <Link className="primary-action" to="/editor">
          エディットモードへ戻る
        </Link>
      </div>
    </section>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
