import { createFileRoute } from "@tanstack/react-router";
import { SettingsRoutePage } from "../app/SettingsRoutePage";

export const Route = createFileRoute("/settings")({
  component: SettingsRoutePage,
});
