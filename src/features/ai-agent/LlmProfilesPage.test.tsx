import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LlmProfilesPage } from "./LlmProfilesPage";
import { listLlmProfiles } from "./llmProfiles";

describe("LlmProfilesPage", () => {
  const roleAssignments = {
    main: { kind: "profile" as const, profileId: "builtin:openai:main" },
    search: { kind: "profile" as const, profileId: "builtin:openai:main" },
    simple: { kind: "profile" as const, profileId: "builtin:openai:main" },
    writing: { kind: "profile" as const, profileId: "builtin:openai:main" },
  };

  const profiles = [
    {
      available: true,
      id: "builtin:openai:main",
      maxOutputTokens: 4096,
      modelId: "gpt-5.4-mini",
      name: "OpenAI 通常",
      providerId: "openai" as const,
      source: "built-in" as const,
      temperature: 0.3,
    },
  ];

  const userProfile = {
    available: true,
    baseURL: "http://localhost:1234/v1",
    id: "user:local-profile",
    maxOutputTokens: 4096,
    modelId: "local-model",
    name: "Local profile",
    providerId: "openai-compatible" as const,
    source: "user" as const,
    supportsToolsOverride: true,
    temperature: 0.3,
  };

  const llmProviders = [
    {
      displayName: "OpenAI",
      id: "openai",
      models: [
        { available: true, displayName: "GPT 5.4 Mini", id: "gpt-5.4-mini", supportsTools: true },
      ],
    },
    {
      displayName: "OpenAI互換",
      id: "openai-compatible",
      models: [
        { available: false, displayName: "local-model", id: "local-model", supportsTools: false },
      ],
    },
  ];

  it("lets the user switch a role assignment by selecting a provider and model", () => {
    const onRoleAssignmentsChange = vi.fn();

    render(
      <LlmProfilesPage
        isWorkspaceOpen={true}
        llmProviders={[
          {
            displayName: "DeepSeek",
            id: "deepseek",
            models: [
              { available: true, displayName: "DeepSeek V4 Flash", id: "deepseek-v4-flash", supportsTools: true },
            ],
          },
          {
            displayName: "OpenAI",
            id: "openai",
            models: [
              { available: true, displayName: "GPT 5.4 Mini", id: "gpt-5.4-mini", supportsTools: true },
              { available: true, displayName: "GPT 5.5", id: "gpt-5.5", supportsTools: true },
            ],
          },
        ]}
        onRoleAssignmentsChange={onRoleAssignmentsChange}
        profiles={[
          {
            available: true,
            id: "builtin:openai:main",
            maxOutputTokens: 4096,
            modelId: "gpt-5.4-mini",
            name: "OpenAI 通常",
            providerId: "openai",
            source: "built-in",
            temperature: 0.3,
          },
        ]}
        roleAssignments={{
          main: { kind: "profile", profileId: "builtin:openai:main" },
          search: { kind: "profile", profileId: "builtin:openai:main" },
          simple: { kind: "profile", profileId: "builtin:openai:main" },
          writing: { kind: "profile", profileId: "builtin:openai:main" },
        }}
      />,
    );

    const mainSelect = screen.getByLabelText("通常チャットモデル");
    expect(mainSelect).toHaveValue("openai:gpt-5.4-mini");

    fireEvent.change(mainSelect, { target: { value: "deepseek:deepseek-v4-flash" } });

    expect(onRoleAssignmentsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        main: {
          kind: "model",
          modelId: "deepseek-v4-flash",
          providerId: "deepseek",
        },
      }),
    );
  });

  it("creates an OpenAI-compatible user profile with a required base URL and custom model id", () => {
    const onUserProfilesChange = vi.fn();

    render(
      <LlmProfilesPage
        isWorkspaceOpen={true}
        llmProviders={llmProviders}
        onRoleAssignmentsChange={vi.fn()}
        onUserProfilesChange={onUserProfilesChange}
        profiles={profiles}
        roleAssignments={roleAssignments}
        userProfiles={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを追加" }));
    fireEvent.change(screen.getByLabelText("provider"), { target: { value: "openai-compatible" } });
    fireEvent.change(screen.getByLabelText("プロフィール名"), { target: { value: "LM Studio" } });
    fireEvent.change(screen.getByLabelText("model ID"), { target: { value: "gemma-3-12b-it" } });

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toHaveTextContent("OpenAI互換providerではbase URLが必須です。");
    expect(onUserProfilesChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("base URL"), { target: { value: "http://localhost:1234/v1" } });
    fireEvent.change(screen.getByLabelText("コンテキスト長上書き"), {
      target: { value: "131072" },
    });
    fireEvent.click(screen.getByLabelText("tool対応"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onUserProfilesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        baseURL: "http://localhost:1234/v1",
        contextWindowTokensOverride: 131072,
        modelId: "gemma-3-12b-it",
        name: "LM Studio",
        providerId: "openai-compatible",
        source: "user",
        supportsToolsOverride: true,
      }),
    ]);
  });

  it.each([
    "https://user:pass@example.com/v1",
    "https://openrouter.ai/api/v1?x=1",
    "https://openrouter.ai/api/v1#models",
  ])("rejects unsafe OpenAI-compatible base URL %s", (baseURL) => {
    const onUserProfilesChange = vi.fn();

    render(
      <LlmProfilesPage
        isWorkspaceOpen={true}
        llmProviders={llmProviders}
        onRoleAssignmentsChange={vi.fn()}
        onUserProfilesChange={onUserProfilesChange}
        profiles={profiles}
        roleAssignments={roleAssignments}
        userProfiles={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを追加" }));
    fireEvent.change(screen.getByLabelText("provider"), { target: { value: "openai-compatible" } });
    fireEvent.change(screen.getByLabelText("プロフィール名"), { target: { value: "OpenRouter" } });
    fireEvent.change(screen.getByLabelText("base URL"), { target: { value: baseURL } });
    fireEvent.change(screen.getByLabelText("model ID"), { target: { value: "openai/gpt-oss-20b" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("alert")).toHaveTextContent("base URLに認証情報、クエリ、フラグメントを含めることはできません。");
    expect(onUserProfilesChange).not.toHaveBeenCalled();
  });

  it("allows a tool-enabled user profile for tool role assignment and disables one without tools", () => {
    const onRoleAssignmentsChange = vi.fn();
    const userProfiles = [
      {
        available: true,
        baseURL: "http://localhost:1234/v1",
        id: "user:tool-profile",
        maxOutputTokens: 4096,
        modelId: "tool-model",
        name: "Tool profile",
        providerId: "openai-compatible" as const,
        source: "user" as const,
        supportsToolsOverride: true,
        temperature: 0.3,
      },
      {
        available: false,
        baseURL: "http://localhost:1234/v1",
        id: "user:no-tool-profile",
        maxOutputTokens: 4096,
        modelId: "plain-model",
        name: "Plain profile",
        providerId: "openai-compatible" as const,
        source: "user" as const,
        supportsToolsOverride: false,
        temperature: 0.3,
        unavailableReason: "このプロフィールはツール実行に対応していません。",
      },
    ];

    render(
      <LlmProfilesPage
        isWorkspaceOpen={true}
        llmProviders={llmProviders}
        onRoleAssignmentsChange={onRoleAssignmentsChange}
        onUserProfilesChange={vi.fn()}
        profiles={[...profiles, ...userProfiles]}
        roleAssignments={roleAssignments}
        userProfiles={userProfiles}
      />,
    );

    const mainSelect = screen.getByLabelText("通常チャットモデル");
    expect(within(mainSelect).getByRole("option", { name: /Tool profile/ })).not.toBeDisabled();
    expect(within(mainSelect).getByRole("option", { name: /Plain profile/ })).toBeDisabled();

    fireEvent.change(mainSelect, { target: { value: "profile:user:tool-profile" } });
    expect(onRoleAssignmentsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        main: { kind: "profile", profileId: "user:tool-profile" },
      }),
    );
  });

  it("hides built-in profiles from the profile list and role assignment options", () => {
    render(
      <LlmProfilesPage
        isWorkspaceOpen={true}
        llmProviders={llmProviders}
        onRoleAssignmentsChange={vi.fn()}
        onUserProfilesChange={vi.fn()}
        profiles={[...profiles, userProfile]}
        roleAssignments={roleAssignments}
        userProfiles={[userProfile]}
      />,
    );

    const profileList = screen.getByLabelText("プロフィール一覧リスト");
    expect(within(profileList).queryByRole("article", { name: /OpenAI 通常/ })).not.toBeInTheDocument();
    expect(within(profileList).getByRole("article", { name: /Local profile/ })).toBeInTheDocument();

    const mainSelect = screen.getByLabelText("通常チャットモデル");
    expect(within(mainSelect).queryByRole("option", { name: /OpenAI 通常/ })).not.toBeInTheDocument();
    expect(within(mainSelect).getByRole("option", { name: /Local profile/ })).toBeInTheDocument();
    expect(mainSelect).toHaveValue("openai:gpt-5.4-mini");
  });

  it("shows the edit form inside only the selected user profile card", () => {
    render(
      <LlmProfilesPage
        isWorkspaceOpen={true}
        llmProviders={llmProviders}
        onRoleAssignmentsChange={vi.fn()}
        onUserProfilesChange={vi.fn()}
        profiles={[
          ...profiles,
          userProfile,
          {
            ...userProfile,
            id: "user:other-profile",
            modelId: "other-model",
            name: "Other profile",
          },
        ]}
        roleAssignments={roleAssignments}
        userProfiles={[userProfile]}
      />,
    );

    const selectedCard = screen.getByRole("article", { name: /Local profile/ });
    const otherCard = screen.getByRole("article", { name: /Other profile/ });

    fireEvent.click(within(selectedCard).getByRole("button", { name: "編集" }));

    const editForm = within(selectedCard).getByLabelText("プロフィール編集フォーム");
    expect(editForm).toBeInTheDocument();
    expect(within(editForm).getByLabelText("プロフィール名")).toHaveValue("Local profile");
    expect(within(editForm).getByLabelText("provider")).toHaveValue("openai-compatible");
    expect(within(editForm).getByLabelText("model ID")).toHaveValue("local-model");
    expect(within(editForm).getByLabelText("base URL")).toHaveValue("http://localhost:1234/v1");
    expect(within(selectedCard).getByText("openai-compatible/local-model")).toBeInTheDocument();
    expect(within(selectedCard).getByText("利用可能")).toBeInTheDocument();
    expect(within(otherCard).queryByLabelText("プロフィール編集フォーム")).not.toBeInTheDocument();

    fireEvent.click(within(editForm).getByRole("button", { name: "キャンセル" }));

    expect(within(selectedCard).queryByLabelText("プロフィール編集フォーム")).not.toBeInTheDocument();
    expect(within(selectedCard).getByRole("button", { name: "編集" })).toBeInTheDocument();
  });

  it("updates a user profile from the form inside its card", () => {
    const onUserProfilesChange = vi.fn();

    render(
      <LlmProfilesPage
        isWorkspaceOpen={true}
        llmProviders={llmProviders}
        onRoleAssignmentsChange={vi.fn()}
        onUserProfilesChange={onUserProfilesChange}
        profiles={[...profiles, userProfile]}
        roleAssignments={roleAssignments}
        userProfiles={[userProfile]}
      />,
    );

    const selectedCard = screen.getByRole("article", { name: /Local profile/ });
    fireEvent.click(within(selectedCard).getByRole("button", { name: "編集" }));

    const editForm = within(selectedCard).getByLabelText("プロフィール編集フォーム");
    fireEvent.change(within(editForm).getByLabelText("プロフィール名"), { target: { value: "Updated local" } });
    fireEvent.change(within(editForm).getByLabelText("model ID"), { target: { value: "updated-model" } });
    fireEvent.click(within(editForm).getByRole("button", { name: "保存" }));

    expect(onUserProfilesChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "user:local-profile",
        modelId: "updated-model",
        name: "Updated local",
      }),
    ]);
  });

  it("shows the new profile form as a card inside the profile list", () => {
    render(
      <LlmProfilesPage
        isWorkspaceOpen={true}
        llmProviders={llmProviders}
        onRoleAssignmentsChange={vi.fn()}
        onUserProfilesChange={vi.fn()}
        profiles={[...profiles, userProfile]}
        roleAssignments={roleAssignments}
        userProfiles={[userProfile]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "プロフィールを追加" }));

    const profileList = screen.getByLabelText("プロフィール一覧リスト");
    const newProfileCard = within(profileList).getByRole("article", { name: "新規プロフィール" });
    expect(within(newProfileCard).getByLabelText("プロフィール編集フォーム")).toBeInTheDocument();
  });

  it("shows an empty profile list message when only built-in profiles exist", () => {
    render(
      <LlmProfilesPage
        isWorkspaceOpen={true}
        llmProviders={llmProviders}
        onRoleAssignmentsChange={vi.fn()}
        onUserProfilesChange={vi.fn()}
        profiles={profiles}
        roleAssignments={roleAssignments}
        userProfiles={[]}
      />,
    );

    expect(screen.queryByRole("article", { name: /OpenAI 通常/ })).not.toBeInTheDocument();
    expect(screen.getByText("プロフィールがありません。")).toBeInTheDocument();
  });

  it("does not show stale default assignment details before a workspace loads LLM providers", () => {
    render(
      <LlmProfilesPage
        isWorkspaceOpen={false}
        llmProviders={[]}
        onRoleAssignmentsChange={vi.fn()}
        onUserProfilesChange={vi.fn()}
        profiles={listLlmProfiles({ providers: [] })}
        roleAssignments={roleAssignments}
        userProfiles={[]}
      />,
    );

    expect(screen.getAllByText("利用可能なモデルがありません。")).toHaveLength(4);
    expect(screen.queryByText("openai/gpt-5.4-mini")).not.toBeInTheDocument();
    expect(screen.queryByText("deepseek/deepseek-v4-pro")).not.toBeInTheDocument();
  });
});
