import { createFileRoute } from "@tanstack/react-router";
import { TemplatesPage } from "../features/workspace/TemplatesPage";

export const Route = createFileRoute("/templates")({
  component: TemplatesRoute,
});

function TemplatesRoute() {
  return <TemplatesPage />;
}
