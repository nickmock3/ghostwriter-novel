import { createFileRoute } from "@tanstack/react-router";
import { EditorRoutePage } from "../app/App";

export const Route = createFileRoute("/editor")({
  component: EditorRoutePage,
});
