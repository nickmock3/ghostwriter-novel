/// <reference types="vite/client" />

import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { App } from "../app/App";
import { DesktopRuntimeGate } from "../shared/client/DesktopRuntimeGate";
import "../styles.css";

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Ghostwriter" },
    ],
    links: [{ rel: "icon", type: "image/png", href: "/favicon.png" }],
  }),
});

function RootComponent() {
  return (
    <RootDocument>
      <DesktopRuntimeGate>
        <App />
      </DesktopRuntimeGate>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
