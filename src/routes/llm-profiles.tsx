import { createFileRoute } from "@tanstack/react-router";
import { LlmProfilesRoutePage } from "../app/App";

export const Route = createFileRoute("/llm-profiles")({
  component: LlmProfilesRoutePage,
});
