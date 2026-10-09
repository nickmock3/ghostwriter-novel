import { createFileRoute } from "@tanstack/react-router";
import { ChatRoutePage } from "../app/ChatRoutePage";

export const Route = createFileRoute("/chat")({
  component: ChatRoutePage,
});
