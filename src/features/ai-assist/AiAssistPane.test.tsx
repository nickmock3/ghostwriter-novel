import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditProposal } from "../edit-proposals/editProposalSchemas";
import { builtInAiAssists, type AiAssistDefinition } from "./aiAssistContracts";
import { AiAssistPane, type AiAssistEditorTarget } from "./AiAssistPane";

beforeEach(() => localStorage.clear());

const fileTarget: AiAssistEditorTarget = {
  content: "星の港に朝が来た。",
  isDirty: false,
  path: "小説/第001章/本文.txt",
  selection: null,
};

const selectionTarget: AiAssistEditorTarget = {
  ...fileTarget,
  selection: { end: 3, start: 0 },
};

function createDeferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

const pendingProposal: EditProposal = {
  createdAt: "2026-07-14T00:00:00.000Z",
  diff: "-星の港に朝が来た。\n+星の港へ、静かな朝が訪れた。",
  id: "proposal-1",
  newText: "星の港へ、静かな朝が訪れた。",
  oldText: "星の港に朝が来た。",
  operation: "edit",
  path: "小説/第001章/本文.txt",
  status: "pending",
  title: "推敲案",
  updatedAt: "2026-07-14T00:00:00.000Z",
};

const executionOptions = [
  { id: "standard", label: "標準モデル", runtime: "vercel-ai" as const },
];

const llmProfiles = [
  {
    available: true,
    id: "builtin:openai:writing",
    llmProfileRole: "writing" as const,
    maxOutputTokens: 4096,
    modelId: "gpt-5.5",
    name: "OpenAI 執筆",
    providerId: "openai" as const,
    source: "built-in" as const,
    temperature: 0.7,
  },
];

const llmProviders = [
  {
    displayName: "OpenAI",
    id: "openai" as const,
    models: [
      {
        available: true,
        displayName: "GPT 5.5",
        id: "gpt-5.5",
        supportsTools: true,
      },
    ],
  },
];

const writingAssignment = {
  kind: "profile" as const,
  profileId: "builtin:openai:writing",
};

const customAssist: AiAssistDefinition = {
  additionalInstructionPlaceholder: "作品固有の補足（任意）",
  description: "作品固有の用語を保ったまま整えます。",
  fixedInstruction: "作品固有の用語を保ったまま、本文を整えてください。",
  id: "custom-polish",
  isBuiltIn: false,
  name: "作品用推敲",
  resultType: "edit-proposal",
  targetType: "text",
};

function renderPane(
  overrides: Partial<React.ComponentProps<typeof AiAssistPane>> = {},
) {
  const onExecute = vi.fn(async () => pendingProposal);
  const onApply = vi.fn(async () => ({ ...pendingProposal, status: "applied" as const }));
  const onReject = vi.fn(async () => ({ ...pendingProposal, status: "rejected" as const }));

  render(
    <AiAssistPane
      executionOptions={executionOptions}
      llmProfiles={llmProfiles}
      llmProviders={llmProviders}
      onApply={onApply}
      onExecute={onExecute}
      onReject={onReject}
      target={fileTarget}
      writingAssignment={writingAssignment}
      {...overrides}
    />,
  );

  return { onApply, onExecute, onReject };
}

describe("AiAssistPane", () => {
  it("presents the target as metadata and exposes assist descriptions as tooltips", () => {
    renderPane({ target: selectionTarget });

    const pane = screen.getByRole("complementary", { name: "AIアシスト" });
    expect(
      within(pane).queryByText("原稿を選び、目的に合うアシストを実行します。"),
    ).not.toBeInTheDocument();

    expect(within(pane).getByRole("region", { name: "対象" })).toBeInTheDocument();

    const assistList = within(pane).getByRole("list", { name: "組み込みアシスト" });
    const polish = within(assistList).getByRole("button", { name: "推敲を実行" });
    expect(within(assistList).getByRole("button", { name: "校正を実行" })).toBeInTheDocument();
    expect(within(assistList).getByRole("button", { name: "ルビ候補を実行" })).toBeInTheDocument();


    const tooltip = within(assistList).getByRole("tooltip", {
      name: "文章表現を改善する編集案を作成します。",
    });
    expect(polish).toHaveAttribute("aria-describedby", tooltip.id);
  });

  it("shows custom assists beside built-ins and manages only custom definitions", async () => {
    const onSaveAssist = vi.fn(async (input: Parameters<NonNullable<React.ComponentProps<typeof AiAssistPane>["onSaveAssist"]>>[0]) => ({
      ...input,
      id: input.id ?? "custom-created",
      isBuiltIn: false as const,
    }));
    const onDeleteAssist = vi.fn(async () => undefined);

    renderPane({
      assists: [...builtInAiAssists, customAssist],
      onDeleteAssist,
      onSaveAssist,
    });

    const customList = screen.getByRole("list", { name: "カスタムアシスト" });
    const customButton = within(customList).getByRole("button", { name: "作品用推敲を実行" });
    expect(customButton).toBeInTheDocument();
    expect(within(customList).getByRole("tooltip", { name: customAssist.description })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "カスタムアシストを管理" }));
    const dialog = screen.getByRole("dialog", { name: "カスタムアシスト管理" });
    expect(within(dialog).getByText(customAssist.name)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "組み込みアシストを編集" })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "作品用推敲を編集" }));
    expect(within(dialog).getByRole("textbox", { name: "名前" })).toHaveValue(customAssist.name);
    expect(within(dialog).getByRole("combobox", { name: "結果種別" })).toHaveValue("edit-proposal");
    expect(within(dialog).getByRole("option", { name: "編集案（確認して反映）" })).toBeInTheDocument();
    expect(within(dialog).getByText("変更内容を確認してから反映できる編集案を作成します。")).toBeInTheDocument();
    expect(within(dialog).queryByDisplayValue("edit-proposal")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "名前" }), {
      target: { value: "更新後の推敲" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(onSaveAssist).toHaveBeenCalledWith(
        expect.objectContaining({
          id: customAssist.id,
          name: "更新後の推敲",
          resultType: "edit-proposal",
        }),
      );
    });
  });

  it.each([
    { assists: builtInAiAssists, name: "without custom assists" },
    { assists: [...builtInAiAssists, customAssist], name: "with custom assists" },
  ])("explains direct execution and target selection $name", ({ assists }) => {
    renderPane({
      assists,
      onDeleteAssist: vi.fn(async () => undefined),
      onSaveAssist: vi.fn(async (input) => ({
        ...input,
        id: input.id ?? "custom-created",
        isBuiltIn: false as const,
      })),
    });

    const pane = screen.getByRole("complementary", { name: "AIアシスト" });
    expect(within(pane).getByRole("button", { name: "カスタムアシストを管理" })).toBeInTheDocument();
    expect(within(pane).getByText(
      "アシストを押すと実行します。選択範囲があれば選択範囲、なければ開いているファイル全体が対象です。",
    )).toBeInTheDocument();

  });

  it("shows a custom additional-instruction placeholder before executing it", () => {
    const { onExecute } = renderPane({
      assists: [...builtInAiAssists, customAssist],
    });
    const customButton = screen.getByRole("button", { name: "作品用推敲を実行" });
    const instruction = screen.getByRole("textbox", { name: "追加指示（任意）" });

    expect(instruction).toHaveAttribute("placeholder", "追加指示（任意）");
    fireEvent.focus(customButton);

    expect(instruction).toHaveAttribute(
      "placeholder",
      customAssist.additionalInstructionPlaceholder,
    );
    expect(onExecute).not.toHaveBeenCalled();
  });

  it("exposes runtime and model selectors without duplicate visual labels", () => {
    renderPane();

    const composer = screen.getByRole("group", { name: "AIアシスト設定" });
    const instruction = screen.getByRole("textbox", { name: "追加指示（任意）" });
    const runtimeSelect = within(composer).getByRole("combobox", { name: "実行方式" });
    const modelSelect = within(composer).getByRole("combobox", { name: "AIアシストLLMモデル" });
    expect(instruction.tagName).toBe("TEXTAREA");
    expect(instruction).toHaveAttribute("placeholder", "追加指示（任意）");
    expect(runtimeSelect).toBeInTheDocument();
    expect(modelSelect).toBeInTheDocument();
    expect(screen.queryByText("実行方式", { selector: "span" })).not.toBeInTheDocument();
    expect(within(composer).getByRole("textbox", { name: "追加指示（任意）" })).toBe(instruction);
    expect(within(composer).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("追加指示（任意）")).not.toBeInTheDocument();
    // Runtime/model controls and direct execution are the behavioral contract; row geometry is covered by browser E2E.
  });

  it("shows the three built-in assists and whether the target is the file or selection", () => {
    const { rerender } = render(
      <AiAssistPane
        executionOptions={executionOptions}
        llmProfiles={llmProfiles}
        llmProviders={llmProviders}
        onApply={vi.fn()}
        onExecute={vi.fn()}
        onReject={vi.fn()}
        target={fileTarget}
        writingAssignment={writingAssignment}
      />,
    );

    expect(screen.getByRole("complementary", { name: "AIアシスト" })).toBeInTheDocument();
    const assistList = screen.getByRole("list", { name: "組み込みアシスト" });
    expect(within(assistList).getByRole("button", { name: "推敲を実行" })).toBeInTheDocument();
    expect(within(assistList).getByRole("button", { name: "校正を実行" })).toBeInTheDocument();
    expect(within(assistList).getByRole("button", { name: "ルビ候補を実行" })).toBeInTheDocument();
    expect(screen.getByText("ファイル全体")).toBeInTheDocument();
    expect(screen.getByText("小説/第001章/本文.txt")).toBeInTheDocument();

    rerender(
      <AiAssistPane
        executionOptions={executionOptions}
        llmProfiles={llmProfiles}
        llmProviders={llmProviders}
        onApply={vi.fn()}
        onExecute={vi.fn()}
        onReject={vi.fn()}
        target={selectionTarget}
        writingAssignment={writingAssignment}
      />,
    );

    expect(screen.getByText("選択範囲（3文字）")).toBeInTheDocument();
  });

  it("executes the clicked assist immediately and preserves composer values", async () => {
    const { onExecute } = renderPane();

    fireEvent.click(screen.getByRole("button", { name: "推敲を実行" }));
    await waitFor(() => {
      expect(onExecute).toHaveBeenLastCalledWith({
        additionalInstruction: undefined,
        assistId: "polish",
        executionOptionId: "standard",
        standardModelSelection: { kind: "default-writing" },
        target: fileTarget,
      });
    });

    fireEvent.change(screen.getByRole("textbox", { name: "追加指示（任意）" }), {
      target: { value: "  固有名詞は変更しない  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "校正を実行" }));

    await waitFor(() => {
      expect(onExecute).toHaveBeenLastCalledWith({
        additionalInstruction: "固有名詞は変更しない",
        assistId: "proofread",
        executionOptionId: "standard",
        standardModelSelection: { kind: "default-writing" },
        target: fileTarget,
      });
    });
    expect(screen.getByRole("textbox", { name: "追加指示（任意）" })).toHaveValue(
      "  固有名詞は変更しない  ",
    );
    expect(screen.getByRole("combobox", { name: "実行方式" })).toHaveValue("standard");
  });

  it.each([
    {
      expectedReason: "ファイルを開いてください。",
      executionOptions,
      name: "no target",
      target: null,
    },
    {
      expectedReason: "先に保存または変更を破棄してください。",
      executionOptions,
      name: "dirty target",
      target: { ...fileTarget, isDirty: true },
    },
    {
      expectedReason: "利用可能なモデルがありません。",
      executionOptions: [],
      name: "no execution option",
      target: fileTarget,
    },
    {
      expectedReason: "対象にできる本文がありません。",
      executionOptions,
      name: "empty target",
      target: { ...fileTarget, content: "" },
    },
  ])("explains and disables execution for $name", ({ expectedReason, executionOptions, target }) => {
    renderPane({ executionOptions, target });

    expect(screen.getByText(expectedReason)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "推敲を実行" })).toBeDisabled();
  });

  it("shows execution-option loading without reporting that no model is available", () => {
    renderPane({ executionOptions: [], isExecutionOptionsLoading: true });

    expect(screen.getByText("実行方式を確認しています…")).toBeInTheDocument();
    expect(screen.queryByText("利用可能なモデルがありません。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "推敲を実行" })).toBeDisabled();
  });

  it("shows execution state and a pending diff that can be applied", async () => {
    const deferred = createDeferredPromise<EditProposal>();
    const onExecute = vi.fn(() => deferred.promise);
    const onApply = vi.fn(async () => ({ ...pendingProposal, status: "applied" as const }));

    renderPane({ onApply, onExecute });
    fireEvent.click(screen.getByRole("button", { name: "推敲を実行" }));

    expect(screen.getByRole("button", { name: "推敲を実行中…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "校正を実行" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "追加指示（任意）" })).toBeDisabled();
    deferred.resolve(pendingProposal);

    const proposal = await screen.findByRole("group", {
      name: "編集案 小説/第001章/本文.txt",
    });
    expect(within(proposal).getByText("推敲案")).toBeInTheDocument();
    expect(proposal.querySelector(".diff-token-delete")).toHaveTextContent("星の港に朝が来た。");
    expect(proposal.querySelector(".diff-token-insert")).toHaveTextContent("星の港へ、静かな朝が訪れた。");

    fireEvent.click(within(proposal).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(pendingProposal));
    expect(within(proposal).getByText("applied")).toBeInTheDocument();
  });

  it("rejects the current proposal without writing it", async () => {
    const { onApply, onReject } = renderPane();
    fireEvent.click(screen.getByRole("button", { name: "推敲を実行" }));

    const proposal = await screen.findByRole("group", {
      name: "編集案 小説/第001章/本文.txt",
    });
    fireEvent.click(within(proposal).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(onReject).toHaveBeenCalledWith(pendingProposal));
    expect(onApply).not.toHaveBeenCalled();
    expect(within(proposal).getByText("rejected")).toBeInTheDocument();
  });

  it("enforces the 500-character instruction limit and renders execution errors", async () => {
    const onExecute = vi.fn(async () => {
      throw new Error("AIアシストを実行できませんでした。");
    });
    renderPane({ onExecute });

    const instruction = screen.getByRole("textbox", { name: "追加指示（任意）" });
    expect(instruction).toHaveAttribute("maxlength", "500");
    fireEvent.click(screen.getByRole("button", { name: "推敲を実行" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "AIアシストを実行できませんでした。",
    );
  });
});
