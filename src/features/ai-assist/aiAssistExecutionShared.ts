import {
  getBuiltInAiAssist,
  type AiAssistDefinition,
  type AiAssistTargetRange,
} from "./aiAssistContracts";

export type ReadSavedAiAssistFile = (input: {
  path: string;
  workspaceRoot: string;
}) => Promise<{
  content: string;
  path: string;
}>;

export type ResolveAiAssist = (
  assistId: string,
) => Promise<AiAssistDefinition | null> | AiAssistDefinition | null;

export function assertTargetRangeWithinContent(
  targetRange: AiAssistTargetRange,
  contentLength: number,
): void {
  if (targetRange.start > contentLength || targetRange.end > contentLength) {
    throw new Error("target range is out of bounds for the saved file content");
  }
}

export function resolveTargetText(content: string, targetRange: AiAssistTargetRange): string {
  return targetRange.start === targetRange.end
    ? content
    : content.slice(targetRange.start, targetRange.end);
}

export async function resolveAiAssistDefinition(
  assistId: string,
  resolveAiAssist?: ResolveAiAssist,
): Promise<AiAssistDefinition | null> {
  return resolveAiAssist ? resolveAiAssist(assistId) : getBuiltInAiAssist(assistId);
}

export async function prepareAiAssistExecution(
  input: {
    additionalInstruction?: string;
    assistId: string;
    editorContent: string;
    targetRange: AiAssistTargetRange;
    workspaceRelativePath: string;
    workspaceRoot: string;
  },
  deps: {
    readSavedFile: ReadSavedAiAssistFile;
    resolveAiAssist?: ResolveAiAssist;
  },
): Promise<{
  assist: AiAssistDefinition;
  savedFile: { content: string; path: string };
  targetText: string;
}> {
  const assist = await resolveAiAssistDefinition(input.assistId, deps.resolveAiAssist);
  if (!assist) {
    throw new Error(`Unknown AI assist: ${input.assistId}`);
  }

  const savedFile = await deps.readSavedFile({
    path: input.workspaceRelativePath,
    workspaceRoot: input.workspaceRoot,
  });
  if (input.editorContent !== savedFile.content) {
    throw new Error("unsaved editor changes detected for the target file");
  }

  assertTargetRangeWithinContent(input.targetRange, savedFile.content.length);
  const targetText = resolveTargetText(savedFile.content, input.targetRange);
  if (targetText.length === 0) {
    throw new Error("target text is empty");
  }

  return { assist, savedFile, targetText };
}
