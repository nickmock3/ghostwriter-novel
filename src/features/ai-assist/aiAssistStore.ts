import { defaultServerDataRoot } from "../../shared/server/applicationStorage";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  aiAssistDefinitionInputSchema,
  builtInAiAssists,
  customAiAssistDefinitionSchema,
  getBuiltInAiAssist,
  type AiAssistDefinition,
  type AiAssistDefinitionInput,
  type CustomAiAssistDefinition,
} from "./aiAssistContracts";

const builtInAiAssistIds = new Set(builtInAiAssists.map((assist) => assist.id));

const aiAssistFileSchema = z.object({
  assists: z.array(customAiAssistDefinitionSchema),
});

export type AiAssistStoreOptions = {
  dataRoot?: string;
};

function assistsFilePath(dataRoot: string): string {
  return path.join(dataRoot, "ai-assists.json");
}

function dataRootOrDefault(dataRoot?: string): string {
  return dataRoot ?? defaultServerDataRoot();
}

function isBuiltInAssistId(assistId: string): boolean {
  return builtInAiAssistIds.has(assistId);
}

function validateCustomAssistInput(input: AiAssistDefinitionInput): AiAssistDefinitionInput {
  return aiAssistDefinitionInputSchema.parse(input);
}

function validatePersistedCustomAssists(assists: CustomAiAssistDefinition[]): void {
  const seenIds = new Set<string>();

  for (const assist of assists) {
    if (isBuiltInAssistId(assist.id) || seenIds.has(assist.id)) {
      throw new Error("Invalid AI assist metadata file");
    }

    seenIds.add(assist.id);
  }
}

async function readCustomAssists(dataRoot: string): Promise<CustomAiAssistDefinition[]> {
  try {
    const parsedFile = aiAssistFileSchema.parse(
      JSON.parse(await readFile(assistsFilePath(dataRoot), "utf8")),
    );
    validatePersistedCustomAssists(parsedFile.assists);
    return parsedFile.assists;
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    if (
      error instanceof SyntaxError ||
      error instanceof z.ZodError ||
      (error instanceof Error && error.message === "Invalid AI assist metadata file")
    ) {
      throw new Error("Invalid AI assist metadata file");
    }

    throw error;
  }
}

async function writeCustomAssists(
  dataRoot: string,
  assists: CustomAiAssistDefinition[],
): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  await writeFile(
    assistsFilePath(dataRoot),
    `${JSON.stringify({ assists }, null, 2)}\n`,
    "utf8",
  );
}

export async function listAiAssists(
  options: AiAssistStoreOptions = {},
): Promise<AiAssistDefinition[]> {
  const dataRoot = dataRootOrDefault(options.dataRoot);
  return [...builtInAiAssists, ...(await readCustomAssists(dataRoot))];
}

export async function getAiAssist(
  options: AiAssistStoreOptions & {
    assistId: string;
  },
): Promise<AiAssistDefinition | null> {
  const builtInAssist = getBuiltInAiAssist(options.assistId);
  if (builtInAssist) {
    return builtInAssist;
  }

  const customAssists = await readCustomAssists(dataRootOrDefault(options.dataRoot));
  return customAssists.find((assist) => assist.id === options.assistId) ?? null;
}

export async function saveCustomAiAssist(
  options: AiAssistStoreOptions & {
    assistId?: string;
    input: AiAssistDefinitionInput;
  },
): Promise<CustomAiAssistDefinition> {
  const dataRoot = dataRootOrDefault(options.dataRoot);
  const input = validateCustomAssistInput(options.input);
  const assistId = options.assistId ?? randomUUID();

  if (isBuiltInAssistId(assistId)) {
    throw new Error("Built-in AI assists cannot be edited");
  }

  const customAssist = customAiAssistDefinitionSchema.parse({
    ...input,
    id: assistId,
    isBuiltIn: false,
  });
  const customAssists = await readCustomAssists(dataRoot);
  const existingIndex = customAssists.findIndex((assist) => assist.id === assistId);
  const nextAssists =
    existingIndex === -1
      ? [...customAssists, customAssist]
      : customAssists.map((assist, index) => (index === existingIndex ? customAssist : assist));

  await writeCustomAssists(dataRoot, nextAssists);
  return customAssist;
}

export async function deleteCustomAiAssist(
  options: AiAssistStoreOptions & {
    assistId: string;
  },
): Promise<void> {
  const dataRoot = dataRootOrDefault(options.dataRoot);

  if (isBuiltInAssistId(options.assistId)) {
    throw new Error("Built-in AI assists cannot be deleted");
  }

  const customAssists = await readCustomAssists(dataRoot);
  await writeCustomAssists(
    dataRoot,
    customAssists.filter((assist) => assist.id !== options.assistId),
  );
}

export type AiAssistStore = {
  deleteCustomAiAssist: (assistId: string) => Promise<void>;
  getAiAssist: (assistId: string) => Promise<AiAssistDefinition | null>;
  listAiAssists: () => Promise<AiAssistDefinition[]>;
  saveCustomAiAssist: (
    input: AiAssistDefinitionInput,
    assistId?: string,
  ) => Promise<CustomAiAssistDefinition>;
};

export function createAiAssistStore(options: AiAssistStoreOptions): AiAssistStore {
  return {
    deleteCustomAiAssist: (assistId) => deleteCustomAiAssist({ ...options, assistId }),
    getAiAssist: (assistId) => getAiAssist({ ...options, assistId }),
    listAiAssists: () => listAiAssists(options),
    saveCustomAiAssist: (input, assistId) =>
      saveCustomAiAssist({ ...options, assistId, input }),
  };
}
