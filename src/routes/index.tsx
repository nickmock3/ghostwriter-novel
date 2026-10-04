import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveStartupWorkModeRoute } from "../app/App";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ replace: true, to: resolveStartupWorkModeRoute() });
  },
});
