import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { unavailableReasonForCurrentChatModelSelection } from "./chatModelSelection";
import { ChatModelSelector, ChatModelUnavailableReasons } from "./ChatModelSelector";

describe("ChatModelSelector", () => {
  it("lists provider models and user-defined profiles", () => {
    const onChange = vi.fn();
    render(
      <ChatModelSelector
        chatModelValue="deepseek:deepseek-v4-pro"
        disabled={false}
        llmProviders={[
          {
            displayName: "DeepSeek",
            id: "deepseek",
            models: [
              {
                available: true,
                displayName: "DeepSeek V4 Pro",
                id: "deepseek-v4-pro",
                supportsTools: true,
              },
            ],
          },
          {
            displayName: "Anthropic",
            id: "anthropic",
            models: [
              {
                available: true,
                displayName: "Claude Sonnet 4.6",
                id: "claude-sonnet-4-6",
                supportsTools: true,
              },
            ],
          },
        ]}
        onChange={onChange}
        resolvedMainSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
        userDefinedProfiles={[
          {
            available: true,
            id: "user:lm-studio",
            maxOutputTokens: 4096,
            modelId: "gemma-3-12b-it",
            name: "LM Studio",
            providerId: "openai-compatible",
            source: "user",
            temperature: 0.3,
          },
        ]}
      />,
    );

    const selector = screen.getByLabelText("チャットLLMモデル");
    expect(selector).toHaveValue("deepseek:deepseek-v4-pro");
    expect(within(selector).getByRole("option", { name: /LM Studio/ })).toBeEnabled();
    expect(within(selector).getByRole("option", { name: "Claude Sonnet 4.6" })).toBeEnabled();

    fireEvent.change(selector, { target: { value: "anthropic:claude-sonnet-4-6" } });
    expect(onChange).toHaveBeenCalledWith("anthropic:claude-sonnet-4-6");
  });

  it("hides built-in profiles and shows their model label when selected", () => {
    render(
      <ChatModelSelector
        chatModelValue="openai:gpt-5.4-mini"
        disabled={false}
        llmProviders={[
          {
            displayName: "OpenAI",
            id: "openai",
            models: [
              { available: true, displayName: "GPT 5.4 Mini", id: "gpt-5.4-mini", supportsTools: true },
            ],
          },
        ]}
        onChange={vi.fn()}
        resolvedMainSelection={{ modelId: "gpt-5.4-mini", providerId: "openai" }}
        userDefinedProfiles={[
          {
            available: true,
            baseURL: "http://localhost:1234/v1",
            id: "user:lm-studio",
            maxOutputTokens: 4096,
            modelId: "gemma-3-12b-it",
            name: "LM Studio",
            providerId: "openai-compatible",
            source: "user",
            supportsToolsOverride: true,
            temperature: 0.3,
          },
        ]}
      />,
    );

    const selector = screen.getByLabelText("チャットLLMモデル");
    expect(selector).toHaveValue("openai:gpt-5.4-mini");
    expect(within(selector).getByRole("option", { name: "GPT 5.4 Mini" })).toBeEnabled();
    expect(within(selector).queryByRole("option", { name: "OpenAI / GPT 5.4 Mini" })).not.toBeInTheDocument();
    expect(within(selector).queryByRole("option", { name: /OpenAI 通常/ })).not.toBeInTheDocument();
    expect(within(selector).getByRole("option", { name: /LM Studio/ })).toBeEnabled();
  });

  it("does not show unavailable reasons for unselected model candidates", () => {
    const chatModelValue = "deepseek:deepseek-v4-pro";
    const llmProviders = [
      {
        displayName: "DeepSeek",
        id: "deepseek",
        models: [
          {
            available: true,
            displayName: "DeepSeek V4 Pro",
            id: "deepseek-v4-pro",
            supportsTools: true,
          },
        ],
      },
      {
        displayName: "OpenAI互換",
        id: "openai-compatible",
        models: [
          {
            available: false,
            displayName: "local-model",
            id: "local-model",
            supportsTools: false,
            unavailableReason: "このモデルはツール実行に対応していません。",
          },
        ],
      },
    ];
    const reasons = unavailableReasonForCurrentChatModelSelection({
      chatModelValue,
      llmProfiles: [],
      llmProviders,
    });

    render(
      <>
        <ChatModelSelector
          chatModelValue={chatModelValue}
          disabled={false}
          llmProviders={llmProviders}
          onChange={vi.fn()}
          resolvedMainSelection={{ modelId: "deepseek-v4-pro", providerId: "deepseek" }}
          userDefinedProfiles={[]}
        />
        <ChatModelUnavailableReasons reasons={reasons} />
      </>,
    );

    expect(screen.getByLabelText("チャットLLMモデル")).toHaveValue("deepseek:deepseek-v4-pro");
    expect(screen.queryByText("このモデルはツール実行に対応していません。")).not.toBeInTheDocument();
  });

  it("does not show a tool support warning for cloud OpenAI-compatible profiles", () => {
    const chatModelValue = "profile:user:openrouter";
    const llmProfiles = [
      {
        available: true,
        baseURL: "https://openrouter.ai/api/v1",
        id: "user:openrouter",
        maxOutputTokens: 4096,
        modelId: "openai/gpt-oss-20b",
        name: "OpenRouter",
        providerId: "openai-compatible" as const,
        source: "user" as const,
        supportsToolsOverride: false,
        temperature: 0.3,
      },
      {
        available: false,
        baseURL: "http://localhost:1234/v1",
        id: "user:lm-studio",
        maxOutputTokens: 4096,
        modelId: "local-model",
        name: "LM Studio",
        providerId: "openai-compatible" as const,
        source: "user" as const,
        supportsToolsOverride: false,
        temperature: 0.3,
        unavailableReason: "このプロフィールはツール実行に対応していません。",
      },
    ];
    const reasons = unavailableReasonForCurrentChatModelSelection({
      chatModelValue,
      llmProfiles,
      llmProviders: [],
    });

    render(
      <>
        <ChatModelSelector
          chatModelValue={chatModelValue}
          disabled={false}
          llmProviders={[]}
          onChange={vi.fn()}
          resolvedMainSelection={{ modelId: "openai/gpt-oss-20b", providerId: "openai-compatible" }}
          userDefinedProfiles={llmProfiles}
        />
        <ChatModelUnavailableReasons reasons={reasons} />
      </>,
    );

    const selector = screen.getByLabelText("チャットLLMモデル");
    expect(selector).toHaveValue("profile:user:openrouter");
    expect(within(selector).getByRole("option", { name: /OpenRouter/ })).toBeEnabled();
    expect(within(selector).getByRole("option", { name: /LM Studio/ })).toBeDisabled();
    expect(screen.queryByText("このプロフィールはツール実行に対応していません。")).not.toBeInTheDocument();
  });
});
