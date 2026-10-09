import {
  modelSelectionFromValue,
  type LlmProviderChoice,
  type SelectedModel,
} from "./llmSelection";
import { selectedModelLabel, type LlmProfileWithAvailability } from "./llmModelSelection";

export type LlmModelSelectorProps = {
  ariaLabel?: string;
  chatModelValue: string;
  disabled: boolean;
  llmProviders: LlmProviderChoice[];
  onChange: (value: string) => void;
  resolvedMainSelection: SelectedModel | null;
  userDefinedProfiles: LlmProfileWithAvailability[];
};

export function LlmModelSelector({
  ariaLabel = "チャットLLMモデル",
  chatModelValue,
  disabled,
  llmProviders,
  onChange,
  resolvedMainSelection,
  userDefinedProfiles,
}: LlmModelSelectorProps) {
  const selectedProfile = userDefinedProfiles.find(profile => `profile:${profile.id}` === chatModelValue);
  const selectedProviderModel = llmProviders.flatMap(provider =>
    provider.models.map(model => ({ ...model, value: `${provider.id}:${model.id}` })),
  ).find(model => model.value === chatModelValue);
  const selectedOption = selectedProfile ?? selectedProviderModel;
  const selectedLabel = selectedProfile?.name ?? selectedProviderModel?.displayName
    ?? selectedModelLabel(resolvedMainSelection, llmProviders);
  const selectedTitle = `${selectedLabel}${selectedOption && !selectedOption.available ? " (利用不可)" : ""}`;
  const hasSelectedOption = Boolean(selectedOption);
  return (
    <label className="chat-model-selector">
      <select
        aria-label={ariaLabel}
        disabled={disabled}
        title={selectedTitle}
        onChange={(event) => onChange(event.target.value)}
        value={chatModelValue}
      >
        {!hasSelectedOption ? (
          <option value={chatModelValue} disabled>{selectedModelLabel(resolvedMainSelection, llmProviders)}</option>
        ) : null}
        {userDefinedProfiles.length > 0 ? (
          <optgroup label="プロフィール">
            {userDefinedProfiles.map((profile) => (
              <option disabled={!profile.available} key={profile.id} value={`profile:${profile.id}`}>
                {profile.name}
                {!profile.available ? " (利用不可)" : ""}
              </option>
            ))}
          </optgroup>
        ) : null}
        {llmProviders.length > 0
          ? llmProviders.map((provider) => (
              <optgroup key={provider.id} label={provider.displayName}>
                {provider.models.map((model) => (
                  <option
                    disabled={!model.available}
                    key={`${provider.id}:${model.id}`}
                    value={`${provider.id}:${model.id}`}
                  >
                    {model.displayName}
                    {!model.available ? " (利用不可)" : ""}
                  </option>
                ))}
              </optgroup>
            ))
          : userDefinedProfiles.length > 0
            ? null
            : null}
      </select>
    </label>
  );
}

export type LlmModelUnavailableReasonsProps = {
  reasons: Array<{ id: string; reason: string }>;
};

export function LlmModelUnavailableReasons({ reasons }: LlmModelUnavailableReasonsProps) {
  if (reasons.length === 0) {
    return null;
  }

  return (
    <div className="model-unavailable-reasons chat-model-unavailable-reasons" aria-label="利用できないモデル">
      {reasons.map((item) => (
        <p key={item.id}>{item.reason}</p>
      ))}
    </div>
  );
}

export function handleLlmModelSelectorChange(
  value: string,
  callbacks: {
    onMainLlmProfileIdChange?: (profileId: string | null) => void;
    onMainLlmModelSelectionChange?: (modelSelection: SelectedModel | null) => void;
    onModelSelectionChange?: (modelSelection: SelectedModel | null) => void;
  },
) {
  if (value.startsWith("profile:")) {
    callbacks.onMainLlmProfileIdChange?.(value.slice("profile:".length));
    callbacks.onMainLlmModelSelectionChange?.(null);
    callbacks.onModelSelectionChange?.(null);
    return;
  }

  const nextSelection = modelSelectionFromValue(value);
  callbacks.onMainLlmModelSelectionChange?.(nextSelection);
  callbacks.onModelSelectionChange?.(nextSelection);
}
