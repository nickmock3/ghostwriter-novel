import { useState } from "react";
import {
  llmProfileRoles,
  llmProfileSchema,
  type LlmProfile,
  type LlmProfileRoleAssignments,
} from "./llmProfiles";
import type { LlmProviderChoice, SelectedModel } from "./llmSelection";

type DisplayProfile = LlmProfile & {
  available: boolean;
  unavailableReason?: string;
};

type LlmProfilesPageProps = {
  errorMessage?: string | null;
  isWorkspaceOpen: boolean;
  llmProviders: LlmProviderChoice[];
  onRoleAssignmentsChange: (assignments: LlmProfileRoleAssignments) => void;
  onUserProfilesChange?: (profiles: LlmProfile[]) => void;
  profiles: DisplayProfile[];
  roleAssignments: LlmProfileRoleAssignments;
  userProfiles?: LlmProfile[];
};

const roleLabels = {
  main: "通常チャット",
  search: "検索サブエージェント",
  simple: "軽作業",
  writing: "執筆・推敲",
} satisfies Record<keyof LlmProfileRoleAssignments, string>;

function selectionValue(selection: SelectedModel | null) {
  return selection ? `${selection.providerId}:${selection.modelId}` : "";
}

function assignmentValue(
  assignment: LlmProfileRoleAssignments[keyof LlmProfileRoleAssignments],
  profiles: DisplayProfile[],
) {
  if (assignment.kind === "profile") {
    const profile = profiles.find((candidate) => candidate.id === assignment.profileId);
    return profile?.source === "user"
      ? `profile:${assignment.profileId}`
      : selectionValue(selectedModelFromAssignment(assignment, profiles));
  }
  return selectionValue(selectedModelFromAssignment(assignment, profiles));
}

function selectedModelFromAssignment(
  assignment: LlmProfileRoleAssignments[keyof LlmProfileRoleAssignments],
  profiles: DisplayProfile[],
): SelectedModel | null {
  if (assignment.kind === "model") {
    return {
      modelId: assignment.modelId,
      providerId: assignment.providerId,
    };
  }

  const profile = profiles.find((candidate) => candidate.id === assignment.profileId);
  return profile
    ? {
        modelId: profile.modelId,
        providerId: profile.providerId,
      }
    : null;
}

function providerModelLabel(
  provider: LlmProviderChoice,
  modelId: string,
) {
  const model = provider.models.find((candidate) => candidate.id === modelId);
  if (model) {
    return `${provider.displayName} / ${model.displayName}`;
  }
  return provider.displayName;
}

function profileOptionLabel(profile: DisplayProfile) {
  return `${profile.name} (${profile.providerId}/${profile.modelId})`;
}

function baseURLHost(baseURL: string | undefined) {
  if (!baseURL) {
    return "";
  }
  try {
    return new URL(baseURL).host;
  } catch {
    return baseURL;
  }
}

function newProfileId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `user:${crypto.randomUUID()}`;
  }
  return `user:${Date.now().toString(36)}`;
}

function errorFromProfile(value: unknown) {
  const parsed = llmProfileSchema.safeParse(value);
  if (parsed.success) {
    return null;
  }
  return parsed.error.issues[0]?.message ?? "プロフィール設定が不正です。";
}

export function LlmProfilesPage({
  errorMessage,
  isWorkspaceOpen,
  llmProviders,
  onRoleAssignmentsChange,
  onUserProfilesChange,
  profiles,
  roleAssignments,
  userProfiles = [],
}: LlmProfilesPageProps) {
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    baseURL: "",
    contextWindowTokensOverride: "",
    maxOutputTokens: "4096",
    modelId: "",
    name: "",
    providerId: "openai-compatible",
    supportsToolsOverride: false,
    temperature: "0.3",
  });
  const [profileFormError, setProfileFormError] = useState<string | null>(null);
  const isEditing = editingProfileId !== null;
  const userDefinedProfiles = profiles.filter((profile) => profile.source === "user");

  function renderProfileForm() {
    return (
      <div className="settings-form llm-profile-card-form" aria-label="プロフィール編集フォーム">
        {profileFormError ? (
          <p className="pane-error" role="alert">
            {profileFormError}
          </p>
        ) : null}
        <label className="settings-field">
          <span>provider</span>
          <select
            aria-label="provider"
            value={profileForm.providerId}
            onChange={(event) => setProfileForm((current) => ({ ...current, providerId: event.target.value }))}
          >
            {llmProviders.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>プロフィール名</span>
          <input
            aria-label="プロフィール名"
            value={profileForm.name}
            onChange={(event) => setProfileForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="settings-field">
          <span>base URL</span>
          <input
            aria-label="base URL"
            disabled={profileForm.providerId === "openai-chatgpt"}
            placeholder="http://localhost:1234/v1"
            value={profileForm.baseURL}
            onChange={(event) => setProfileForm((current) => ({ ...current, baseURL: event.target.value }))}
          />
        </label>
        <label className="settings-field">
          <span>model ID</span>
          <input
            aria-label="model ID"
            value={profileForm.modelId}
            onChange={(event) => setProfileForm((current) => ({ ...current, modelId: event.target.value }))}
          />
        </label>
        <label className="settings-field">
          <span>temperature</span>
          <input
            aria-label="temperature"
            disabled={profileForm.providerId === "openai-chatgpt"}
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={profileForm.temperature}
            onChange={(event) => setProfileForm((current) => ({ ...current, temperature: event.target.value }))}
          />
        </label>
        <label className="settings-field">
          <span>最大出力トークン数</span>
          <input
            aria-label="最大出力トークン数"
            disabled={profileForm.providerId === "openai-chatgpt"}
            type="number"
            min="1"
            max="128000"
            value={profileForm.maxOutputTokens}
            onChange={(event) => setProfileForm((current) => ({ ...current, maxOutputTokens: event.target.value }))}
          />
        </label>
        <label className="settings-field">
          <span>コンテキスト長上書き（任意）</span>
          <input
            aria-label="コンテキスト長上書き"
            placeholder="未設定時はモデル既定または200000"
            type="number"
            min="1"
            max="100000000"
            value={profileForm.contextWindowTokensOverride}
            onChange={(event) =>
              setProfileForm((current) => ({
                ...current,
                contextWindowTokensOverride: event.target.value,
              }))
            }
          />
        </label>
        <label className="settings-checkbox-field">
          <input
            aria-label="tool対応"
            type="checkbox"
            checked={profileForm.supportsToolsOverride}
            onChange={(event) => setProfileForm((current) => ({
              ...current,
              supportsToolsOverride: event.target.checked,
            }))}
          />
          <span>tool対応</span>
        </label>
        <div className="settings-actions">
          <button type="button" className="primary-action" onClick={saveProfile}>保存</button>
          <button type="button" className="secondary-action" onClick={() => setEditingProfileId(null)}>キャンセル</button>
        </div>
      </div>
    );
  }

  function startNewProfile() {
    setEditingProfileId("new");
    setProfileForm({
      baseURL: "",
      contextWindowTokensOverride: "",
      maxOutputTokens: "4096",
      modelId: "",
      name: "",
      providerId: "openai-compatible",
      supportsToolsOverride: false,
      temperature: "0.3",
    });
    setProfileFormError(null);
  }

  function startEditProfile(profile: LlmProfile) {
    setEditingProfileId(profile.id);
    setProfileForm({
      baseURL: profile.baseURL ?? "",
      contextWindowTokensOverride:
        profile.contextWindowTokensOverride !== undefined
          ? String(profile.contextWindowTokensOverride)
          : "",
      maxOutputTokens: String(profile.maxOutputTokens),
      modelId: profile.modelId,
      name: profile.name,
      providerId: profile.providerId,
      supportsToolsOverride: profile.supportsToolsOverride ?? false,
      temperature: String(profile.temperature),
    });
    setProfileFormError(null);
  }

  function saveProfile() {
    const contextWindowOverrideText = profileForm.contextWindowTokensOverride.trim();
    const nextProfile = {
      id: editingProfileId === "new" ? newProfileId() : editingProfileId ?? newProfileId(),
      maxOutputTokens: Number.parseInt(profileForm.maxOutputTokens, 10),
      modelId: profileForm.modelId.trim(),
      name: profileForm.name.trim(),
      providerId: profileForm.providerId,
      source: "user",
      temperature: Number.parseFloat(profileForm.temperature),
      ...(profileForm.providerId !== "openai-chatgpt" && profileForm.baseURL.trim() ? { baseURL: profileForm.baseURL.trim() } : {}),
      ...(contextWindowOverrideText
        ? { contextWindowTokensOverride: Number(contextWindowOverrideText) }
        : {}),
      supportsToolsOverride: profileForm.supportsToolsOverride,
    };
    const error = errorFromProfile(nextProfile);
    if (error) {
      setProfileFormError(error);
      return;
    }

    const parsedProfile = llmProfileSchema.parse(nextProfile);
    const nextProfiles =
      editingProfileId && editingProfileId !== "new"
        ? userProfiles.map((profile) => profile.id === editingProfileId ? parsedProfile : profile)
        : [...userProfiles, parsedProfile];
    onUserProfilesChange?.(nextProfiles);
    setEditingProfileId(null);
    setProfileFormError(null);
  }

  function deleteProfile(profileId: string) {
    onUserProfilesChange?.(userProfiles.filter((profile) => profile.id !== profileId));
  }

  return (
    <section aria-label="LLMプロフィール管理" className="llm-profiles-page">
      <div className="llm-profiles-page-inner">
        <div className="llm-profiles-page-heading">
          <h2>LLMプロフィール</h2>
        </div>

        {errorMessage ? (
          <p className="pane-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        {!isWorkspaceOpen ? (
          <p className="settings-helper">ワークスペースを開くと、APIキー状態に応じたプロフィールを確認できます。</p>
        ) : null}

        <section className="settings-section" aria-label="用途別割り当て">
          <h3>用途別割り当て</h3>
          <div className="llm-role-grid">
            {llmProfileRoles.map((role) => {
              const canSelectModel = isWorkspaceOpen && llmProviders.length > 0;
              const selectedModel = canSelectModel
                ? selectedModelFromAssignment(roleAssignments[role], profiles)
                : null;
              const selectedValue = canSelectModel ? assignmentValue(roleAssignments[role], profiles) : "";

              return (
                <label className="settings-field" key={role}>
                  <span>{roleLabels[role]}</span>
                  <select
                    aria-label={`${roleLabels[role]}モデル`}
                    disabled={!canSelectModel}
                    onChange={(event) => {
                      if (event.target.value.startsWith("profile:")) {
                        onRoleAssignmentsChange({
                          ...roleAssignments,
                          [role]: {
                            kind: "profile",
                            profileId: event.target.value.slice("profile:".length),
                          },
                        });
                        return;
                      }

                      const [providerId, modelId] = event.target.value.split(":");
                      if (!providerId || !modelId) {
                        return;
                      }

                      const nextSelection = { modelId, providerId } satisfies SelectedModel;
                      const currentSelection = selectedModelFromAssignment(roleAssignments[role], profiles);
                      if (
                        currentSelection?.providerId === nextSelection.providerId &&
                        currentSelection?.modelId === nextSelection.modelId
                      ) {
                        return;
                      }

                      onRoleAssignmentsChange({
                        ...roleAssignments,
                        [role]: {
                          kind: "model",
                          modelId: nextSelection.modelId,
                          providerId: nextSelection.providerId,
                        },
                      });
                    }}
                    value={selectedValue}
                  >
                    {llmProviders.length === 0 ? (
                      <option value="">
                        利用可能なモデルがありません。
                      </option>
                    ) : null}
                    {llmProviders.map((provider) => (
                      <optgroup key={provider.id} label={provider.displayName}>
                        {provider.models.map((model) => (
                          <option
                            disabled={!model.available}
                            key={`${provider.id}:${model.id}`}
                            value={`${provider.id}:${model.id}`}
                          >
                            {providerModelLabel(provider, model.id)}
                            {!model.available ? " (利用不可)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    {userDefinedProfiles.length > 0 ? (
                      <optgroup label="ユーザー定義プロフィール">
                        {userDefinedProfiles.map((profile) => (
                          <option
                            disabled={!profile.available}
                            key={profile.id}
                            value={`profile:${profile.id}`}
                          >
                            {profileOptionLabel(profile)}
                            {!profile.available ? " (利用不可)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  {selectedModel ? (
                    <small>{selectedModel.providerId}/{selectedModel.modelId}</small>
                  ) : null}
                </label>
              );
            })}
          </div>
        </section>

        <section className="settings-section" aria-label="プロフィール一覧">
          <div className="settings-section-heading">
            <h3>プロフィール一覧</h3>
            <button type="button" className="primary-action" onClick={startNewProfile}>
              プロフィールを追加
            </button>
          </div>
          <div className="llm-profile-list" aria-label="プロフィール一覧リスト">
            {editingProfileId === "new" ? (
              <article className="llm-profile-card llm-profile-card--editing llm-profile-card--new" aria-label="新規プロフィール">
                <div className="llm-profile-card-summary">
                  <div>
                    <h4>新規プロフィール</h4>
                    <p>新しいプロフィールを作成します。</p>
                  </div>
                </div>
                {renderProfileForm()}
              </article>
            ) : null}
            {userDefinedProfiles.map((profile) => {
              const isEditingProfile = editingProfileId === profile.id;

              return (
                <article
                  className={`llm-profile-card${isEditingProfile ? " llm-profile-card--editing" : ""}`}
                  key={profile.id}
                  aria-label={profile.name}
                >
                  <div className="llm-profile-card-summary">
                    <div>
                      <h4>{profile.name}</h4>
                      <p>
                        {profile.providerId}/{profile.modelId}
                      </p>
                      {profile.providerId === "openai-compatible" && profile.baseURL ? (
                        <small>
                          {baseURLHost(profile.baseURL)} / {profile.modelId}
                        </small>
                      ) : null}
                    </div>
                    <div>
                      <span data-available={profile.available ? "true" : "false"}>
                        {profile.available ? "利用可能" : profile.unavailableReason ?? "利用不可"}
                      </span>
                      {profile.source === "user" && !isEditingProfile ? (
                        <div className="settings-actions">
                          <button type="button" className="secondary-action" onClick={() => startEditProfile(profile)}>編集</button>
                          <button type="button" className="danger-action" onClick={() => deleteProfile(profile.id)}>削除</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {isEditingProfile ? renderProfileForm() : null}
                </article>
              );
            })}
            {userDefinedProfiles.length === 0 && !isEditing ? <p>プロフィールがありません。</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}
