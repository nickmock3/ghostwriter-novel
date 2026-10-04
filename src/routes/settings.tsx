import { createFileRoute } from "@tanstack/react-router";
import { SettingsRoutePage } from "../app/App";

export const Route = createFileRoute("/settings")({
  component: SettingsRoutePage,
});
