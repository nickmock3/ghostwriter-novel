import type { WorkspaceTemplate, WorkspaceTemplateItem } from "./workspaceTemplateContracts";

export type WorkspaceTemplateSource = WorkspaceTemplate["source"];
export type WorkspaceTemplateItemKind = WorkspaceTemplateItem["kind"];

export type TemplateItemDraft = {
  content: string;
  id: string;
  kind: WorkspaceTemplateItemKind;
  path: string;
};

export type TemplateDraft = {
  id: string;
  items: TemplateItemDraft[];
  name: string;
  source: WorkspaceTemplateSource;
};

export type ValidationResult = {
  issues: string[];
  plannedDirectories: string[];
  plannedFiles: string[];
};

export function templateItemKey(item: TemplateItemDraft) {
  return item.id;
}

function defaultCreateItemId(): string {
  return `template-item-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultCreateTemplateId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `template-${slug || "draft"}-${Math.random().toString(36).slice(2, 10)}`;
}

export function mapApiTemplateToDraft(
  template: WorkspaceTemplate,
  createItemId: () => string = defaultCreateItemId,
): TemplateDraft {
  return {
    id: template.id,
    items: template.items.map((item) => ({
      ...item,
      content: item.kind === "file" ? item.content : "",
      id: createItemId(),
    })),
    name: template.name,
    source: template.source,
  };
}

export function createBlankTemplate(
  name = "新規テンプレート",
  createTemplateId?: () => string,
): TemplateDraft {
  return {
    id: createTemplateId?.() ?? defaultCreateTemplateId(name),
    items: [],
    name,
    source: "user",
  };
}

export function cloneTemplate(
  template: TemplateDraft,
  createItemId: () => string = defaultCreateItemId,
): TemplateDraft {
  return {
    ...template,
    items: template.items.map((item) => ({
      ...item,
      id: createItemId(),
    })),
  };
}

export function normalizeDisplayPath(value: string): string {
  return value.replaceAll("\\", "/").trim().replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

export function normalizeTemplatePath(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/");

  if (!trimmed) {
    throw new Error("パスは空にできません。");
  }

  if (trimmed.startsWith("/")) {
    throw new Error("パスはワークスペース相対で入力してください。");
  }

  const normalized = trimmed.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new Error("パスは空にできません。");
  }

  if (segments.some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) {
    throw new Error("`.`から始まるセグメントは使えません。");
  }

  return segments.join("/");
}

export function validateTemplate(template: TemplateDraft): ValidationResult {
  const issues: string[] = [];
  const plannedDirectories = new Set<string>();
  const plannedFiles = new Set<string>();

  if (!template.name.trim()) {
    issues.push("テンプレート名は空にできません。");
  }

  for (const item of template.items) {
    let normalizedPath: string;

    try {
      normalizedPath = normalizeTemplatePath(item.path);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "パスの検証に失敗しました。");
      continue;
    }

    const segments = normalizedPath.split("/");
    if (item.kind === "directory") {
      if (segments.length > 2) {
        issues.push("ディレクトリは二層まで作成できます。");
        continue;
      }

      plannedDirectories.add(normalizedPath);
      continue;
    }

    if (segments.length > 3) {
      issues.push("ファイルは三層まで作成できます。");
      continue;
    }

    if (item.content.includes("\u0000")) {
      issues.push("ファイル本文にNULLバイトは含められません。");
      continue;
    }

    plannedFiles.add(normalizedPath);

    const parentPath = segments.slice(0, -1).join("/");
    if (parentPath) {
      plannedDirectories.add(parentPath);
    }
  }

  return {
    issues: Array.from(new Set(issues)),
    plannedDirectories: Array.from(plannedDirectories).sort((left, right) => left.localeCompare(right)),
    plannedFiles: Array.from(plannedFiles).sort((left, right) => left.localeCompare(right)),
  };
}

export function buildTemplatePreview(template: TemplateDraft): ValidationResult {
  const plannedDirectories = new Set<string>();
  const plannedFiles = new Set<string>();

  for (const item of template.items) {
    const normalizedPath = normalizeDisplayPath(item.path);
    if (!normalizedPath) {
      continue;
    }

    if (item.kind === "directory") {
      plannedDirectories.add(normalizedPath);
      continue;
    }

    plannedFiles.add(normalizedPath);
    const parentPath = normalizedPath.split("/").slice(0, -1).join("/");
    if (parentPath) {
      plannedDirectories.add(parentPath);
    }
  }

  return {
    issues: [],
    plannedDirectories: Array.from(plannedDirectories).sort((left, right) => left.localeCompare(right)),
    plannedFiles: Array.from(plannedFiles).sort((left, right) => left.localeCompare(right)),
  };
}

export function emptyTemplateNotice(currentTemplate: TemplateDraft | null) {
  if (!currentTemplate) {
    return "テンプレートを読み込んでいます。";
  }

  if (currentTemplate.source === "built-in") {
    return "アプリ内定義テンプレートは複製してから編集してください。";
  }

  return "テンプレートを編集できます。";
}
