import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { defaultConversationDataRoot } from "../ai-chat/conversationHistory";
import {
  hasHiddenPathSegment,
  normalizeWorkspaceRelativePath,
} from "./workspaceFilePaths";
import {
  builtInWorkspaceTemplateId,
  chatModeNovelWorkspaceTemplateId,
  workspaceTemplateItemSchema,
  type WorkspaceTemplateItem,
} from "./workspaceTemplateContracts";

export { builtInWorkspaceTemplateId, chatModeNovelWorkspaceTemplateId };
export type { WorkspaceTemplateItem };

const workspaceTemplateInputSchema = z.object({
  id: z.string().min(1).optional(),
  items: z.array(workspaceTemplateItemSchema),
  name: z.string(),
});

const userWorkspaceTemplateSchema = workspaceTemplateInputSchema.extend({
  id: z.string().min(1),
  source: z.literal("user"),
});

const workspaceTemplateFileSchema = z.object({
  templates: z.array(userWorkspaceTemplateSchema),
});

export type WorkspaceTemplateInput = z.infer<typeof workspaceTemplateInputSchema>;
export type UserWorkspaceTemplate = z.infer<typeof userWorkspaceTemplateSchema>;

export type BuiltInWorkspaceTemplate = {
  readonly id: typeof builtInWorkspaceTemplateId | typeof chatModeNovelWorkspaceTemplateId;
  readonly items: readonly WorkspaceTemplateItem[];
  readonly name: string;
  readonly source: "built-in";
};

export type WorkspaceTemplate = BuiltInWorkspaceTemplate | UserWorkspaceTemplate;

export type WorkspaceTemplateStoreOptions = {
  dataRoot?: string;
};

export const builtInWorkspaceTemplate: BuiltInWorkspaceTemplate = {
  id: builtInWorkspaceTemplateId,
  items: [
    { kind: "file", path: "AGENTS.md", content: `# AGENTS.md

## このワークスペースについて

このワークスペースは小説執筆用ワークスペースです。

## 構成

- \`小説/第001章/本文.txt\`: 章本文を書きます。章タイトルはパスではなく本文の先頭に書いてください。
- \`小説/第001章/章内プロット.md\`: 章の目的、登場人物、場所、時系列、伏線、未決事項を整理します。
- \`設定/\`: 登場人物、世界観、用語集など、作品内設定の正として扱う資料を置きます。
- \`プロット/\`: 全体構成や大きな展開を整理します。
- \`資料/\`: 調査メモや参考情報を置きます。
- \`メモ/\`: 思いつきや未整理の断片を置きます。

## AIへの指示

- 作者の文体、語り口、視点、既存の設定を尊重してください。
- 本文を大きく書き換える場合は、意図と影響範囲を明確にしてください。
- 設定や時系列に矛盾がありそうな場合は、断定せず該当箇所を示して確認してください。
- ファイル編集はアプリの承認制フローに従い、勝手に適用したと主張しないでください。
` },
    { kind: "directory", path: "小説" },
    { kind: "directory", path: "小説/第001章" },
    { kind: "file", path: "小説/第001章/本文.txt", content: `第001章 仮タイトル

` },
    { kind: "file", path: "小説/第001章/章内プロット.md", content: `# 第001章 章内プロット

## 章の目的

- 

## 登場人物

- 

## 場所

- 

## 時系列

- 

## 伏線

- 

## 未決事項

- 
` },
    { kind: "directory", path: "設定" },
    { kind: "file", path: "設定/登場人物.md", content: `# 登場人物

` },
    { kind: "file", path: "設定/世界観.md", content: `# 世界観

` },
    { kind: "file", path: "設定/用語集.md", content: `# 用語集

` },
    { kind: "directory", path: "プロット" },
    { kind: "file", path: "プロット/全体構成.md", content: `# 全体構成

` },
    { kind: "directory", path: "資料" },
    { kind: "directory", path: "メモ" },
  ],
  name: "小説ワークスペース",
  source: "built-in",
};

export const chatModeNovelWorkspaceTemplate: BuiltInWorkspaceTemplate = {
  id: chatModeNovelWorkspaceTemplateId,
  items: builtInWorkspaceTemplate.items.map((item) => {
    if (item.kind === "file" && item.path === "AGENTS.md") {
      return {
        ...item,
        content: item.content.replace(
          "このワークスペースは小説執筆用ワークスペースです。",
          "このワークスペースは小説執筆用ワークスペースです。AIと会話しながら小説を書き進めることを想定しています。",
        ),
      };
    }

    return item;
  }),
  name: "チャットモード小説ワークスペース",
  source: "built-in",
};

const builtInWorkspaceTemplates = [
  builtInWorkspaceTemplate,
  chatModeNovelWorkspaceTemplate,
] as const;

function templatesFilePath(dataRoot: string): string {
  return path.join(dataRoot, "workspace-templates.json");
}

function dataRootOrDefault(dataRoot?: string): string {
  return dataRoot ?? defaultConversationDataRoot();
}

function pathSegments(workspaceRelativePath: string): string[] {
  return workspaceRelativePath.split(/[\\/]+/).filter(Boolean);
}

function validateTemplatePath(item: WorkspaceTemplateItem): WorkspaceTemplateItem {
  const normalizedPath = normalizeWorkspaceRelativePath(item.path);

  if (hasHiddenPathSegment(normalizedPath)) {
    throw new Error("Hidden path segments are not allowed");
  }

  const segments = pathSegments(normalizedPath);
  if (item.kind === "directory" && segments.length > 2) {
    throw new Error("Directory template paths must be at most two segments");
  }

  if (item.kind === "file" && segments.length > 3) {
    throw new Error("File template paths must be at most three segments");
  }

  if (item.kind === "file" && item.content.includes("\u0000")) {
    throw new Error("Template file content must be text");
  }

  return { ...item, path: normalizedPath };
}

export function validateWorkspaceTemplateDefinition(
  template: unknown,
): WorkspaceTemplateInput {
  const parsedTemplate = workspaceTemplateInputSchema.parse(template);
  const name = parsedTemplate.name.trim();

  if (!name) {
    throw new Error("Template name is required");
  }

  return {
    ...parsedTemplate,
    items: parsedTemplate.items.map(validateTemplatePath),
    name,
  };
}

async function readUserTemplates(dataRoot: string): Promise<UserWorkspaceTemplate[]> {
  try {
    const parsedFile = workspaceTemplateFileSchema.parse(
      JSON.parse(await readFile(templatesFilePath(dataRoot), "utf8")),
    );
    return parsedFile.templates.map((template) => ({
      ...template,
      ...validateWorkspaceTemplateDefinition(template),
      source: "user",
    }));
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }

    if (error instanceof SyntaxError || error instanceof z.ZodError) {
      throw new Error("Invalid workspace template metadata file");
    }

    throw error;
  }
}

async function writeUserTemplates(
  dataRoot: string,
  templates: UserWorkspaceTemplate[],
): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  await writeFile(
    templatesFilePath(dataRoot),
    `${JSON.stringify({ templates }, null, 2)}\n`,
    "utf8",
  );
}

export async function listWorkspaceTemplates(
  options: WorkspaceTemplateStoreOptions = {},
): Promise<WorkspaceTemplate[]> {
  const dataRoot = dataRootOrDefault(options.dataRoot);
  return [...builtInWorkspaceTemplates, ...(await readUserTemplates(dataRoot))];
}

export async function getWorkspaceTemplate(
  options: WorkspaceTemplateStoreOptions & {
    templateId: string;
  },
): Promise<WorkspaceTemplate | null> {
  if (options.templateId === chatModeNovelWorkspaceTemplateId) {
    return chatModeNovelWorkspaceTemplate;
  }

  const templates = await listWorkspaceTemplates({ dataRoot: options.dataRoot });
  return templates.find((template) => template.id === options.templateId) ?? null;
}

export async function saveUserWorkspaceTemplate(
  options: WorkspaceTemplateStoreOptions & {
    template: WorkspaceTemplateInput;
  },
): Promise<UserWorkspaceTemplate> {
  const dataRoot = dataRootOrDefault(options.dataRoot);
  const template = validateWorkspaceTemplateDefinition(options.template);
  const templateId = template.id ?? randomUUID();

  if (
    templateId === builtInWorkspaceTemplateId ||
    templateId === chatModeNovelWorkspaceTemplateId
  ) {
    throw new Error("Built-in templates cannot be edited");
  }

  const userTemplate: UserWorkspaceTemplate = {
    ...template,
    id: templateId,
    source: "user",
  };
  const templates = await readUserTemplates(dataRoot);
  const existingIndex = templates.findIndex((item) => item.id === templateId);
  const nextTemplates =
    existingIndex === -1
      ? [...templates, userTemplate]
      : templates.map((item, index) => (index === existingIndex ? userTemplate : item));

  await writeUserTemplates(dataRoot, nextTemplates);
  return userTemplate;
}

export async function deleteUserWorkspaceTemplate(
  options: WorkspaceTemplateStoreOptions & {
    templateId: string;
  },
): Promise<void> {
  const dataRoot = dataRootOrDefault(options.dataRoot);

  if (
    options.templateId === builtInWorkspaceTemplateId ||
    options.templateId === chatModeNovelWorkspaceTemplateId
  ) {
    throw new Error("Built-in templates cannot be deleted");
  }

  const templates = await readUserTemplates(dataRoot);
  await writeUserTemplates(
    dataRoot,
    templates.filter((template) => template.id !== options.templateId),
  );
}
