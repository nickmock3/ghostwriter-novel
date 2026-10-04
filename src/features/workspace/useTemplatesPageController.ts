import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../shared/client/apiTransport";
import {
  workspaceTemplateListResponseSchema,
  workspaceTemplateSaveResponseSchema,
} from "./workspaceTemplateContracts";
import {
  cloneTemplate,
  createBlankTemplate,
  mapApiTemplateToDraft,
  validateTemplate,
  type TemplateDraft,
  type WorkspaceTemplateItemKind,
} from "./templateDraftModel";

function formatApiMessage(body: unknown, fallbackMessage: string) {
  const messageBody = body as { message?: unknown } | null;
  if (messageBody && typeof messageBody.message === "string") {
    return messageBody.message;
  }

  return fallbackMessage;
}

function createRuntimeItemId(index: number) {
  return `template-item-${index + 1}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRuntimeTemplateId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `template-${slug || "draft"}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useTemplatesPageController() {
  const [templates, setTemplates] = useState<TemplateDraft[]>([]);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const itemSequenceRef = useRef(0);

  const currentTemplate = draft;
  const validation = useMemo(() => (currentTemplate ? validateTemplate(currentTemplate) : null), [currentTemplate]);
  const selectedTemplateId = draft?.source === "built-in" || draft?.source === "user" ? draft.id : null;
  const validationIssues = validation?.issues ?? [];
  const canSave = Boolean(
    draft && draft.source === "user" && validationIssues.length === 0 && !isSaving && !isDeleting,
  );

  function nextItemId() {
    return createRuntimeItemId(itemSequenceRef.current++);
  }

  function createDraftFromTemplate(template: TemplateDraft): TemplateDraft {
    itemSequenceRef.current = template.items.length;
    return cloneTemplate(template, nextItemId);
  }

  function selectTemplate(template: TemplateDraft) {
    setDraft(createDraftFromTemplate(template));
    setFeedbackMessage(null);
    setErrorMessage(null);
  }

  async function loadTemplates(options?: { selectTemplateId?: string | null }) {
    const response = await apiFetch("/api/workspace/templates");
    const body: unknown = await response.json();

    if (!response.ok) {
      throw new Error(formatApiMessage(body, "テンプレート一覧の読み込みに失敗しました。"));
    }

    const parsedBody = workspaceTemplateListResponseSchema.parse(body);
    let itemIndex = 0;
    const nextTemplates = parsedBody.templates.map((template) =>
      mapApiTemplateToDraft(template, () => createRuntimeItemId(itemIndex++)),
    );
    setTemplates(nextTemplates);

    const nextSelectedId = options?.selectTemplateId ?? selectedTemplateId;
    if (nextSelectedId) {
      const nextSelectedTemplate = nextTemplates.find((template) => template.id === nextSelectedId);

      if (nextSelectedTemplate) {
        setDraft(createDraftFromTemplate(nextSelectedTemplate));
        return;
      }
    }

    const firstTemplate = nextTemplates[0];
    setDraft(firstTemplate ? createDraftFromTemplate(firstTemplate) : null);
  }

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setErrorMessage(null);

    void loadTemplates()
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "テンプレート一覧の読み込みに失敗しました。");
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateCurrentTemplate(
    updater: (template: TemplateDraft) => TemplateDraft,
    options?: { resetFeedback?: boolean },
  ) {
    if (options?.resetFeedback !== false) {
      setFeedbackMessage(null);
    }
    setErrorMessage(null);
    setDraft((current) => (current ? updater(current) : current));
  }

  async function saveTemplate(template: TemplateDraft) {
    const response = await apiFetch(`/api/workspace/templates/${encodeURIComponent(template.id)}`, {
      body: JSON.stringify({
        items: template.items.map((item) =>
          item.kind === "directory"
            ? { kind: "directory", path: item.path }
            : { content: item.content, kind: "file", path: item.path },
        ),
        name: template.name,
      }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });
    const body: unknown = await response.json();

    if (!response.ok) {
      throw new Error(formatApiMessage(body, "テンプレートの保存に失敗しました。"));
    }

    const parsedBody = workspaceTemplateSaveResponseSchema.parse(body);
    const savedTemplate = mapApiTemplateToDraft(parsedBody.template, nextItemId);
    setDraft(createDraftFromTemplate(savedTemplate));
    await loadTemplates({ selectTemplateId: savedTemplate.id });
    setFeedbackMessage("保存しました。");
  }

  async function handleSave() {
    if (!draft || draft.source === "built-in" || (validation?.issues.length ?? 0) > 0) {
      return;
    }

    setIsSaving(true);
    setFeedbackMessage(null);
    setErrorMessage(null);

    try {
      await saveTemplate(draft);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "テンプレートの保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft || draft.source !== "user") {
      return;
    }

    setIsDeleting(true);
    setFeedbackMessage(null);
    setErrorMessage(null);

    try {
      const response = await apiFetch(`/api/workspace/templates/${encodeURIComponent(draft.id)}`, {
        method: "DELETE",
      });
      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(formatApiMessage(body, "テンプレートの削除に失敗しました。"));
      }

      await loadTemplates();
      setFeedbackMessage("削除しました。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "テンプレートの削除に失敗しました。");
    } finally {
      setIsDeleting(false);
    }
  }

  function handleCreateTemplate() {
    setDraft(createBlankTemplate(undefined, () => createRuntimeTemplateId("新規テンプレート")));
    itemSequenceRef.current = 0;
    setFeedbackMessage(null);
    setErrorMessage(null);
  }

  async function handleDuplicateBuiltIn() {
    if (!draft || draft.source !== "built-in") {
      return;
    }

    const duplicatedTemplate: TemplateDraft = {
      ...cloneTemplate(
        {
          ...draft,
          id: createRuntimeTemplateId(`${draft.name}-copy`),
          name: `${draft.name} の複製`,
        },
        nextItemId,
      ),
      source: "user",
    };

    setIsSaving(true);
    setFeedbackMessage(null);
    setErrorMessage(null);

    try {
      await saveTemplate(duplicatedTemplate);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "テンプレートの複製に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  }

  function handleNameChange(name: string) {
    updateCurrentTemplate((template) => ({ ...template, name }));
  }

  function handleItemKindChange(itemId: string, kind: WorkspaceTemplateItemKind) {
    updateCurrentTemplate((template) => ({
      ...template,
      items: template.items.map((item) =>
        item.id === itemId
          ? kind === "directory"
            ? { ...item, content: "", kind }
            : { ...item, kind, content: item.content ?? "" }
          : item,
      ),
    }));
  }

  function handleItemPathChange(itemId: string, path: string) {
    updateCurrentTemplate((template) => ({
      ...template,
      items: template.items.map((item) => (item.id === itemId ? { ...item, path } : item)),
    }));
  }

  function handleItemContentChange(itemId: string, content: string) {
    updateCurrentTemplate((template) => ({
      ...template,
      items: template.items.map((item) => (item.id === itemId ? { ...item, content } : item)),
    }));
  }

  function handleAddItem() {
    updateCurrentTemplate((template) => ({
      ...template,
      items: [
        ...template.items,
        {
          content: "",
          id: createRuntimeItemId(template.items.length),
          kind: "directory" as const,
          path: `new-directory-${template.items.length + 1}`,
        },
      ],
    }));
  }

  function handleDeleteItem(itemId: string) {
    updateCurrentTemplate((template) => ({
      ...template,
      items: template.items.filter((item) => item.id !== itemId),
    }));
  }

  return {
    canSave,
    currentTemplate,
    errorMessage,
    feedbackMessage,
    handleAddItem,
    handleCreateTemplate,
    handleDelete,
    handleDeleteItem,
    handleDuplicateBuiltIn,
    handleItemContentChange,
    handleItemKindChange,
    handleItemPathChange,
    handleNameChange,
    handleSave,
    isDeleting,
    isLoading,
    isSaving,
    selectTemplate,
    selectedTemplateId,
    templates,
    validationIssues,
  };
}
