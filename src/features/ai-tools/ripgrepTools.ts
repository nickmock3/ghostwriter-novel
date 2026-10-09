import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { resolveWorkspaceFilePath } from "../workspace/workspaceFilePaths";
import {
  localWorkspaceSearchStore,
  type WorkspaceGlobInput,
  type WorkspaceGlobOutput,
  type WorkspaceGrepInput,
  type WorkspaceGrepOutput,
  type WorkspaceSearchInput,
  type WorkspaceSearchOutput,
} from "../workspace/workspaceSearchStore";

export type ReadToolInput = z.infer<typeof readToolInputSchema>;
export type ReadToolOutput = z.infer<typeof readToolOutputSchema>;
export type GlobToolInput = WorkspaceGlobInput & { workspaceRoot: string };
export type GlobToolOutput = WorkspaceGlobOutput;
export type GrepToolInput = WorkspaceGrepInput & { workspaceRoot: string };
export type GrepToolOutput = WorkspaceGrepOutput;
export type SearchToolInput = WorkspaceSearchInput & { workspaceRoot: string };
export type SearchToolOutput = WorkspaceSearchOutput;

const MAX_READ_BYTES = 1024 * 1024;
const MAX_READ_LINES = 2000;
const baseToolInputSchema = z.object({
  workspaceRoot: z.string().min(1),
});

export const readToolInputSchema = baseToolInputSchema.extend({
  path: z.string().min(1),
});

export const readToolOutputSchema = z.object({
  content: z.string(),
  path: z.string(),
  totalLines: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const globToolInputSchema = baseToolInputSchema.extend({
  pattern: z.string().min(1),
}) satisfies z.ZodType<GlobToolInput>;

export const globToolOutputSchema = z.object({
  limit: z.number().int().positive(),
  matches: z.array(z.string()),
  truncated: z.boolean(),
}) satisfies z.ZodType<GlobToolOutput>;

export const grepToolInputSchema = baseToolInputSchema.extend({
  query: z.string().min(1),
  options: z
    .object({
      glob: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
    })
    .optional(),
}) satisfies z.ZodType<GrepToolInput>;

export const grepMatchSchema = z.object({
  line: z.string(),
  lineNumber: z.number().int().positive(),
  path: z.string(),
});

export const grepToolOutputSchema = z.object({
  limit: z.number().int().positive(),
  matches: z.array(grepMatchSchema),
  truncated: z.boolean(),
}) satisfies z.ZodType<GrepToolOutput>;

export const searchToolInputSchema = baseToolInputSchema.extend({
  query: z.string().min(1),
}) satisfies z.ZodType<SearchToolInput>;

export const searchToolOutputSchema = z.object({
  limit: z.number().int().positive(),
  queryTerms: z.array(z.string()),
  results: z.array(
    z.object({
      lineNumber: z.number().int().positive(),
      path: z.string(),
      score: z.number(),
      snippet: z.string(),
    }),
  ),
  truncated: z.boolean(),
}) satisfies z.ZodType<SearchToolOutput>;

function truncateLines(content: string): { content: string; totalLines: number; truncated: boolean } {
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;

  if (totalLines <= MAX_READ_LINES) {
    return { content, totalLines, truncated: false };
  }

  return {
    content: [...lines.slice(0, MAX_READ_LINES), `[truncated after ${MAX_READ_LINES} lines]`].join(
      "\n",
    ),
    totalLines,
    truncated: true,
  };
}

export async function readWorkspaceFile(input: ReadToolInput): Promise<ReadToolOutput> {
  const parsedInput = readToolInputSchema.parse(input);
  const resolved = await resolveWorkspaceFilePath(parsedInput.workspaceRoot, parsedInput.path, {
    requireExisting: true,
  });
  const fileStat = await stat(resolved.absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("File is not readable as text");
  }

  if (fileStat.size > MAX_READ_BYTES) {
    throw new Error(`File is too large to read (max ${MAX_READ_BYTES} bytes)`);
  }

  const buffer = await readFile(resolved.absolutePath);
  if (buffer.includes(0x00)) {
    throw new Error("File appears to be binary");
  }

  return readToolOutputSchema.parse({
    path: resolved.workspaceRelativePath,
    ...truncateLines(buffer.toString("utf8")),
  });
}

export async function globWorkspace(input: GlobToolInput): Promise<GlobToolOutput> {
  const parsedInput = globToolInputSchema.parse(input);
  const context = await localWorkspaceSearchStore.createContext(parsedInput.workspaceRoot);
  return localWorkspaceSearchStore.glob(context, { pattern: parsedInput.pattern });
}

export async function grepWorkspace(input: GrepToolInput): Promise<GrepToolOutput> {
  const parsedInput = grepToolInputSchema.parse(input);
  const context = await localWorkspaceSearchStore.createContext(parsedInput.workspaceRoot);
  return localWorkspaceSearchStore.grep(context, {
    options: parsedInput.options,
    query: parsedInput.query,
  });
}

export async function searchWorkspace(input: SearchToolInput): Promise<SearchToolOutput> {
  const parsedInput = searchToolInputSchema.parse(input);
  const context = await localWorkspaceSearchStore.createContext(parsedInput.workspaceRoot);
  return localWorkspaceSearchStore.search(context, { query: parsedInput.query });
}
