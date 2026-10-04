import type { Conversation, EditProposal, ToolActivity, ToolResultSummary } from "./conversationSchemas";

export const COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS = 512;
export const COMPACT_TOOL_HISTORY_TURN_MAX_CHARS = 2048;
export const COMPACT_TOOL_HISTORY_CONVERSATION_MAX_CHARS = 8192;
export const COMPACT_TOOL_RESULT_TRUNCATION_MARKER = "[truncated]";

const HISTORY_HEADER = "[圧縮された過去のツール履歴]";
const HISTORY_NOTICE =
  "これは過去の履歴であり、現在のファイル内容を保証しません。原稿の編集や事実確認ではworkspaceを再度Readしてください。";

type SummarizeCompactToolResultInput = {
  input: unknown;
  output: unknown;
  toolName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function shortText(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value.trim().replace(/\s+/g, " ");
}

function truncateWithMarker(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  if (maxChars <= COMPACT_TOOL_RESULT_TRUNCATION_MARKER.length) {
    return COMPACT_TOOL_RESULT_TRUNCATION_MARKER.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - COMPACT_TOOL_RESULT_TRUNCATION_MARKER.length)}${COMPACT_TOOL_RESULT_TRUNCATION_MARKER}`;
}

type SummarySegment = {
  shrinkable: boolean;
  text: string;
};

function composeBoundedSummary(
  segments: SummarySegment[],
  options?: { maxChars?: number; shrinkPriority?: number[] },
): string {
  const maxChars = options?.maxChars ?? COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS;
  const originals = segments.map((segment) => segment.text);
  const working = segments.map((segment) => ({ ...segment }));

  const totalLength = () => working.reduce((sum, segment) => sum + segment.text.length, 0);

  if (totalLength() <= maxChars) {
    return working.map((segment) => segment.text).join("");
  }

  const defaultShrinkPriority = working
    .map((segment, index) => (segment.shrinkable ? index : -1))
    .filter((index) => index >= 0)
    .reverse();
  const shrinkPriority = options?.shrinkPriority ?? defaultShrinkPriority;

  for (const index of shrinkPriority) {
    while (totalLength() > maxChars && working[index].text.length > 0) {
      const excess = totalLength() - maxChars;
      const nextLength = Math.max(0, working[index].text.length - excess);
      working[index].text =
        nextLength === 0 ? "" : truncateWithMarker(originals[index], nextLength);
    }
  }

  return working.map((segment) => segment.text).join("");
}

function failedDetail(output: unknown): string | null {
  if (!isRecord(output)) {
    return null;
  }
  return shortText(output.error) ?? shortText(output.message);
}

function pathFrom(input: unknown, output: unknown): string | null {
  if (isRecord(input) && shortText(input.path)) {
    return shortText(input.path);
  }
  if (isRecord(output) && shortText(output.path)) {
    return shortText(output.path);
  }
  return null;
}

function summarizeRead(input: unknown, output: unknown): string {
  const targetPath = pathFrom(input, output) ?? "unknown";
  const failed = failedDetail(output);
  if (failed) {
    return composeBoundedSummary(
      [
        { shrinkable: false, text: "Read " },
        { shrinkable: true, text: targetPath },
        { shrinkable: false, text: ": failed, " },
        { shrinkable: true, text: failed },
      ],
      { shrinkPriority: [3, 1] },
    );
  }
  const totalLines = isRecord(output) && typeof output.totalLines === "number" ? output.totalLines : 0;
  const truncated = isRecord(output) && output.truncated === true;
  return composeBoundedSummary([
    { shrinkable: false, text: "Read " },
    { shrinkable: true, text: targetPath },
    { shrinkable: false, text: `: completed, ${totalLines} lines, truncated=${truncated}` },
  ]);
}

function summarizeGrepLike(toolName: string, input: unknown, output: unknown): string {
  const query = isRecord(input) ? shortText(input.query) : null;
  const failed = failedDetail(output);
  if (failed) {
    return composeBoundedSummary(
      [
        { shrinkable: false, text: toolName },
        { shrinkable: true, text: query ? ` ${query}` : "" },
        { shrinkable: false, text: ": failed, " },
        { shrinkable: true, text: failed },
      ],
      { shrinkPriority: [3, 1] },
    );
  }
  const matches = isRecord(output) && Array.isArray(output.matches) ? output.matches : [];
  const paths = [
    ...new Set(
      matches
        .map((match) => (isRecord(match) ? shortText(match.path) : null))
        .filter((value): value is string => value !== null),
    ),
  ].slice(0, 10);
  const pathSuffix = paths.length > 0 ? `, ${paths.join(", ")}` : "";
  return composeBoundedSummary(
    [
      { shrinkable: false, text: toolName },
      { shrinkable: true, text: query ? ` ${query}` : "" },
      { shrinkable: false, text: `: completed, ${matches.length} matches` },
      { shrinkable: true, text: pathSuffix },
    ],
    { shrinkPriority: [3, 1] },
  );
}

function summarizeSearch(input: unknown, output: unknown): string {
  const query = isRecord(input) ? shortText(input.query) : null;
  const failed = failedDetail(output);
  if (failed) {
    return composeBoundedSummary(
      [
        { shrinkable: false, text: "Search" },
        { shrinkable: true, text: query ? ` ${query}` : "" },
        { shrinkable: false, text: ": failed, " },
        { shrinkable: true, text: failed },
      ],
      { shrinkPriority: [3, 1] },
    );
  }
  const results = isRecord(output) && Array.isArray(output.results) ? output.results : [];
  const paths = [
    ...new Set(
      results
        .map((result) => (isRecord(result) ? shortText(result.path) : null))
        .filter((value): value is string => value !== null),
    ),
  ].slice(0, 10);
  const pathSuffix = paths.length > 0 ? `, ${paths.join(", ")}` : "";
  return composeBoundedSummary(
    [
      { shrinkable: false, text: "Search" },
      { shrinkable: true, text: query ? ` ${query}` : "" },
      { shrinkable: false, text: `: completed, ${results.length} matches` },
      { shrinkable: true, text: pathSuffix },
    ],
    { shrinkPriority: [3, 1] },
  );
}

function summarizeGlob(input: unknown, output: unknown): string {
  const pattern = isRecord(input) ? shortText(input.pattern) : null;
  const failed = failedDetail(output);
  if (failed) {
    return composeBoundedSummary(
      [
        { shrinkable: false, text: "Glob" },
        { shrinkable: true, text: pattern ? ` ${pattern}` : "" },
        { shrinkable: false, text: ": failed, " },
        { shrinkable: true, text: failed },
      ],
      { shrinkPriority: [3, 1] },
    );
  }
  const matches = isRecord(output) && Array.isArray(output.matches) ? output.matches : [];
  const paths = matches
    .map((match) => (typeof match === "string" ? shortText(match) : null))
    .filter((value): value is string => value !== null)
    .slice(0, 10);
  const pathSuffix = paths.length > 0 ? `, ${paths.join(", ")}` : "";
  return composeBoundedSummary(
    [
      { shrinkable: false, text: "Glob" },
      { shrinkable: true, text: pattern ? ` ${pattern}` : "" },
      { shrinkable: false, text: `: completed, ${matches.length} matches` },
      { shrinkable: true, text: pathSuffix },
    ],
    { shrinkPriority: [3, 1] },
  );
}

function summarizeEditLike(operation: string, input: unknown, output: unknown): string {
  const targetPath = pathFrom(input, output) ?? "unknown";
  const failed = failedDetail(output);
  if (failed) {
    return composeBoundedSummary(
      [
        { shrinkable: false, text: `${operation} ` },
        { shrinkable: true, text: targetPath },
        { shrinkable: false, text: ": failed, " },
        { shrinkable: true, text: failed },
      ],
      { shrinkPriority: [3, 1] },
    );
  }
  return composeBoundedSummary([
    { shrinkable: false, text: `${operation} ` },
    { shrinkable: true, text: targetPath },
    { shrinkable: false, text: ": completed" },
  ]);
}

function summarizeGeneric(toolName: string, input: unknown, output: unknown): string {
  const boundedToolName = truncateWithMarker(toolName, 128);
  const failed = failedDetail(output);
  if (failed) {
    return composeBoundedSummary(
      [
        { shrinkable: false, text: `${boundedToolName}: failed, ` },
        { shrinkable: true, text: failed },
      ],
      { shrinkPriority: [1] },
    );
  }
  const rawStatus = isRecord(output) ? (shortText(output.status) ?? "completed") : "completed";
  const status = truncateWithMarker(rawStatus, 128);
  const query = isRecord(input) ? shortText(input.query) : null;
  const detail = query ?? (isRecord(output) ? shortText(output.message) : null);
  if (!detail) {
    return composeBoundedSummary([
      { shrinkable: false, text: `${boundedToolName}: ${status}` },
    ]);
  }
  return composeBoundedSummary(
    [
      { shrinkable: false, text: `${boundedToolName}: ${status}, ` },
      { shrinkable: true, text: detail },
    ],
    { shrinkPriority: [1] },
  );
}

function summarizeDelegateWriting(input: unknown, output: unknown): string {
  const targetPath =
    (isRecord(output) ? shortText(output.targetPath) : null) ??
    (isRecord(input) ? shortText(input.targetPath) : null) ??
    "unknown";
  const failed = failedDetail(output);
  if (failed) {
    return composeBoundedSummary(
      [
        { shrinkable: false, text: "DelegateWriting " },
        { shrinkable: true, text: targetPath },
        { shrinkable: false, text: ": failed, " },
        { shrinkable: true, text: failed },
      ],
      { shrinkPriority: [3, 1] },
    );
  }
  const artifactId = isRecord(output) ? shortText(output.artifactId) : null;
  const latencyMs = isRecord(output) && typeof output.latencyMs === "number" ? output.latencyMs : undefined;
  const operation = isRecord(output) ? shortText(output.operation) : null;
  const detail = [
    artifactId ? `artifactId=${artifactId}` : null,
    latencyMs !== undefined ? `latencyMs=${latencyMs}` : null,
    operation ? `operation=${operation}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(", ");
  return composeBoundedSummary([
    { shrinkable: false, text: "DelegateWriting " },
    { shrinkable: true, text: targetPath },
    { shrinkable: false, text: ": completed" },
    { shrinkable: true, text: detail ? `, ${detail}` : "" },
  ]);
}

function summarizeCreateWritingEditProposal(input: unknown, output: unknown): string {
  const artifactId = isRecord(input) ? shortText(input.artifactId) : null;
  const targetPath = isRecord(output) ? shortText(output.path) : null;
  const operation = isRecord(output) ? shortText(output.operation) : null;
  const sourceRole = isRecord(output) ? shortText(output.sourceRole) : null;
  const failed = failedDetail(output);
  if (failed) {
    return composeBoundedSummary(
      [
        { shrinkable: false, text: "CreateWritingEditProposal" },
        { shrinkable: true, text: artifactId ? ` ${artifactId}` : "" },
        { shrinkable: false, text: ": failed, " },
        { shrinkable: true, text: failed },
      ],
      { shrinkPriority: [3, 1] },
    );
  }
  return composeBoundedSummary([
    { shrinkable: false, text: "CreateWritingEditProposal" },
    { shrinkable: true, text: artifactId ? ` ${artifactId}` : "" },
    { shrinkable: false, text: ": completed" },
    {
      shrinkable: true,
      text: (() => {
        const detail = [
          targetPath,
          operation ? `operation=${operation}` : null,
          sourceRole ? `sourceRole=${sourceRole}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join(", ");
        return detail ? `, ${detail}` : "";
      })(),
    },
  ]);
}

export function summarizeCompactToolResult({
  input,
  output,
  toolName,
}: SummarizeCompactToolResultInput): string {
  switch (toolName) {
    case "Read":
      return summarizeRead(input, output);
    case "Grep":
      return summarizeGrepLike("Grep", input, output);
    case "Search":
      return summarizeSearch(input, output);
    case "Glob":
      return summarizeGlob(input, output);
    case "Edit":
      return summarizeEditLike("edit", input, output);
    case "Create":
      return summarizeEditLike("create", input, output);
    case "CreateDirectory":
      return summarizeEditLike("createDirectory", input, output);
    case "DelegateWriting":
      return summarizeDelegateWriting(input, output);
    case "CreateWritingEditProposal":
      return summarizeCreateWritingEditProposal(input, output);
    default:
      return summarizeGeneric(toolName, input, output);
  }
}

function sortByCreatedAt<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function relatedActivities(conversation: Conversation, assistantMessageId: string): ToolActivity[] {
  return sortByCreatedAt(
    conversation.toolActivities.filter((activity) => activity.assistantMessageId === assistantMessageId),
  );
}

function relatedSummaries(conversation: Conversation, assistantMessageId: string): ToolResultSummary[] {
  return sortByCreatedAt(
    conversation.toolResultSummaries.filter((summary) => summary.assistantMessageId === assistantMessageId),
  );
}

function relatedProposals(conversation: Conversation, assistantMessageId: string): EditProposal[] {
  return sortByCreatedAt(
    conversation.editProposals.filter((proposal) => proposal.assistantMessageId === assistantMessageId),
  );
}

function buildHistorySections(conversation: Conversation, assistantMessageId: string): string[] {
  const activities = relatedActivities(conversation, assistantMessageId);
  const summaries = relatedSummaries(conversation, assistantMessageId);
  const proposals = relatedProposals(conversation, assistantMessageId);
  const sections: string[] = [];

  if (activities.length > 0) {
    sections.push(
      `ツール実行:\n${activities.map((activity) => `- ${activity.label} (${activity.status})`).join("\n")}`,
    );
  }
  if (summaries.length > 0) {
    sections.push(`ツール結果:\n${summaries.map((summary) => `- ${summary.summary}`).join("\n")}`);
  }
  if (proposals.length > 0) {
    sections.push(
      `編集提案:\n${proposals.map((proposal) => `- ${proposal.operation} ${proposal.path} (${proposal.status})`).join("\n")}`,
    );
  }

  return sections;
}

function truncateHistoryBlock(block: string, maxChars: number): string {
  if (block.length <= maxChars) {
    return block;
  }
  if (maxChars <= COMPACT_TOOL_RESULT_TRUNCATION_MARKER.length) {
    return COMPACT_TOOL_RESULT_TRUNCATION_MARKER.slice(0, maxChars);
  }
  return `${block.slice(0, maxChars - COMPACT_TOOL_RESULT_TRUNCATION_MARKER.length)}${COMPACT_TOOL_RESULT_TRUNCATION_MARKER}`;
}

export function buildCompactHistoryBlock(
  conversation: Conversation,
  assistantMessageId: string,
  maxChars: number,
): string | null {
  const sections = buildHistorySections(conversation, assistantMessageId);
  if (sections.length === 0) {
    return null;
  }

  const body = [HISTORY_HEADER, "", HISTORY_NOTICE, "", ...sections].join("\n");
  return truncateHistoryBlock(body, maxChars);
}

export function appendCompactHistoryToContent(
  conversation: Conversation,
  assistantMessageId: string,
  content: string,
  maxChars: number,
): string {
  const history = buildCompactHistoryBlock(conversation, assistantMessageId, maxChars);
  if (!history) {
    return content;
  }
  if (content.trim() === "") {
    return history;
  }
  return `${content}\n\n${history}`;
}
