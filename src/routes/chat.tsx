import { createFileRoute } from "@tanstack/react-router";
import { ChatRoutePage } from "../app/App";

export const Route = createFileRoute("/chat")({
  component: ChatRoutePage,
});
