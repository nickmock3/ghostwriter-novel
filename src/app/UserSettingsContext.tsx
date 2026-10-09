import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { UserSettings } from "../features/settings/settingsStorage";

export type UserSettingsContextValue = {
  settings: UserSettings;
  setSettings: Dispatch<SetStateAction<UserSettings>>;
};

export const UserSettingsContext = createContext<UserSettingsContextValue | null>(null);

export function useUserSettingsContext() {
  const value = useContext(UserSettingsContext);
  if (!value) {
    throw new Error("useUserSettingsContext must be used inside App.");
  }
  return value;
}
