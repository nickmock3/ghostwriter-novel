import type { EditorTarget } from "../editor/editorTarget";
import { describe, expect, it } from "vitest";
import type { AiAssistDefinition } from "./aiAssistContracts";
import {
  executionBlockReason,
  modelSelectionBlockReason,
  resolveInstructionPlaceholder,
  targetKindLabel,
} from "./aiAssistPaneHelpers";

const fileTarget: EditorTarget = {
  content: "星の港に朝が来た。",
  isDirty: false,
  path: "小説/第001章/本文.txt",
  selection: null,
};

const executionOptions = [
  { id: "standard", label: "標準モデル", runtime: "vercel-ai" as const },
];

describe("targetKindLabel", () => {
  it("labels the whole file when there is no selection", () => {
    expect(targetKindLabel(fileTarget)).toBe("ファイル全体");
  });

  it("labels the selection length when a range is selected", () => {
    expect(
      targetKindLabel({
        ...fileTarget,
        selection: { end: 3, start: 0 },
      }),
    ).toBe("選択範囲（3文字）");
  });
});

describe("executionBlockReason", () => {
  it.each([
    {
      expected: "ファイルを開いてください。",
      isExecutionOptionsLoading: false,
      name: "no target",
      options: executionOptions,
      target: null,
    },
    {
      expected: "先に保存または変更を破棄してください。",
      isExecutionOptionsLoading: false,
      name: "dirty target",
      options: executionOptions,
      target: { ...fileTarget, isDirty: true },
    },
    {
      expected: "対象にできる本文がありません。",
      isExecutionOptionsLoading: false,
      name: "empty target",
      options: executionOptions,
      target: { ...fileTarget, content: "" },
    },
    {
      expected: "実行方式を確認しています…",
      isExecutionOptionsLoading: true,
      name: "loading options",
      options: [],
      target: fileTarget,
    },
    {
      expected: "利用可能なモデルがありません。",
      isExecutionOptionsLoading: false,
      name: "no options",
      options: [],
      target: fileTarget,
    },
  ])("returns $expected for $name", ({ expected, isExecutionOptionsLoading, options, target }) => {
    expect(executionBlockReason(target, options, isExecutionOptionsLoading)).toBe(expected);
  });

  it("returns null when execution is allowed", () => {
    expect(executionBlockReason(fileTarget, executionOptions, false)).toBeNull();
  });
});

describe("modelSelectionBlockReason", () => {
  it("returns the first unavailable standard-model reason", () => {
    expect(
      modelSelectionBlockReason({
        executionOption: executionOptions[0],
        standardModelSelection: { kind: "default-writing" },
        unavailableReasons: [{ id: "openai:gpt-5.5", reason: "APIキーが未設定です。" }],
      }),
    ).toBe("APIキーが未設定です。");
  });

  it("allows an available standard model", () => {
    expect(
      modelSelectionBlockReason({
        executionOption: executionOptions[0],
        standardModelSelection: { kind: "default-writing" },
        unavailableReasons: [],
      }),
    ).toBeNull();
  });
});

describe("resolveInstructionPlaceholder", () => {
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

  it("uses the default placeholder without an active assist", () => {
    expect(resolveInstructionPlaceholder([customAssist], null)).toBe("追加指示（任意）");
  });

  it("uses the default placeholder for built-in assists", () => {
    expect(
      resolveInstructionPlaceholder(
        [
          {
            description: "文章表現を改善する編集案を作成します。",
            fixedInstruction: "推敲してください。",
            id: "polish",
            isBuiltIn: true,
            name: "推敲",
            resultType: "edit-proposal",
            targetType: "text",
          },
        ],
        "polish",
      ),
    ).toBe("追加指示（任意）");
  });

  it("uses the custom assist placeholder when present", () => {
    expect(resolveInstructionPlaceholder([customAssist], "custom-polish")).toBe(
      "作品固有の補足（任意）",
    );
  });

  it("falls back to the default when the custom placeholder is blank", () => {
    expect(
      resolveInstructionPlaceholder(
        [{ ...customAssist, additionalInstructionPlaceholder: "   " }],
        "custom-polish",
      ),
    ).toBe("追加指示（任意）");
  });
});
