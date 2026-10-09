import { createFileRoute } from "@tanstack/react-router";
import { LlmProfilesRoutePage } from "../app/LlmProfilesRoutePage";

export const Route = createFileRoute("/llm-profiles")({
  component: LlmProfilesRoutePage,
});
