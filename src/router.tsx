import { Link, createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

type GetRouterOptions = {
  history?: RouterHistory;
};

export function getRouter(options: GetRouterOptions = {}) {
  return createRouter({
    defaultNotFoundComponent: NotFoundComponent,
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
          エディット画面へ戻る
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
