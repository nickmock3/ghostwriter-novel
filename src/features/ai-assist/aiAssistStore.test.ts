import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  builtInAiAssists,
  type AiAssistDefinitionInput,
} from "./aiAssistContracts";
import {
  deleteCustomAiAssist,
  getAiAssist,
  listAiAssists,
  saveCustomAiAssist,
} from "./aiAssistStore";

function tempDataRoot() {
  return mkdtempSync(path.join(tmpdir(), "ghostwriter-ai-assists-"));
}

const customInput: AiAssistDefinitionInput = {
  additionalInstructionPlaceholder: "今回だけの補足",
  description: "作品固有の用語を保ったまま整えます。",
  fixedInstruction: "作品固有の用語と文体を保ったまま、本文を整えてください。",
  name: "作品用推敲",
  resultType: "edit-proposal",
  targetType: "text",
};

describe("AI assist store", () => {
  it("lists built-ins with persisted custom assists and supports update/delete", async () => {
    const dataRoot = tempDataRoot();

    try {
      const created = await saveCustomAiAssist({ dataRoot, input: customInput });
      expect(created).toMatchObject({
        ...customInput,
        isBuiltIn: false,
      });
      expect(created.id).not.toBe("polish");

      const listed = await listAiAssists({ dataRoot });
      expect(listed.map((assist) => assist.id)).toEqual([
        ...builtInAiAssists.map((assist) => assist.id),
        created.id,
      ]);
      expect(await getAiAssist({ dataRoot, assistId: created.id })).toEqual(created);

      const updated = await saveCustomAiAssist({
        dataRoot,
        input: { ...customInput, description: "更新後の説明" },
        assistId: created.id,
      });
      expect(updated.description).toBe("更新後の説明");
      expect((await listAiAssists({ dataRoot })).at(-1)?.description).toBe("更新後の説明");

      await deleteCustomAiAssist({ assistId: created.id, dataRoot });
      expect(await getAiAssist({ assistId: created.id, dataRoot })).toBeNull();
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });

  it("protects built-ins and rejects invalid metadata instead of trusting it", async () => {
    const dataRoot = tempDataRoot();

    try {
      await expect(
        saveCustomAiAssist({
          dataRoot,
          input: customInput,
          assistId: "polish",
        }),
      ).rejects.toThrow("Built-in AI assists cannot be edited");
      await expect(
        deleteCustomAiAssist({ assistId: "proofread", dataRoot }),
      ).rejects.toThrow("Built-in AI assists cannot be deleted");

      writeFileSync(path.join(dataRoot, "ai-assists.json"), "{bad json", "utf8");
      await expect(listAiAssists({ dataRoot })).rejects.toThrow(
        "Invalid AI assist metadata file",
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });

  it("rejects persisted definitions whose ids collide with built-ins or each other", async () => {
    const dataRoot = tempDataRoot();
    const customDefinition = {
      ...customInput,
      id: "custom-polish",
      isBuiltIn: false as const,
    };

    try {
      writeFileSync(
        path.join(dataRoot, "ai-assists.json"),
        JSON.stringify({
          assists: [{ ...customDefinition, id: "polish" }],
        }),
        "utf8",
      );
      await expect(listAiAssists({ dataRoot })).rejects.toThrow(
        "Invalid AI assist metadata file",
      );

      writeFileSync(
        path.join(dataRoot, "ai-assists.json"),
        JSON.stringify({ assists: [customDefinition, customDefinition] }),
        "utf8",
      );
      await expect(listAiAssists({ dataRoot })).rejects.toThrow(
        "Invalid AI assist metadata file",
      );
    } finally {
      rmSync(dataRoot, { force: true, recursive: true });
    }
  });
});
