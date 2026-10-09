import { createFileRoute } from "@tanstack/react-router";
import { EditorRoutePage } from "../app/EditorRoutePage";

export const Route = createFileRoute("/editor")({
  component: EditorRoutePage,
});
