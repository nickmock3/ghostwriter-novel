import { z } from "zod";
import { apiFetch } from "../../shared/client/apiTransport";

export const fileTreeResponseSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(["directory", "file"]),
      path: z.string(),
    }),
  ),
  limit: z.number(),
  truncated: z.boolean(),
});

export const fileContentResponseSchema = z.object({
  content: z.string(),
  path: z.string(),
});

export type FileTreeResponse = z.infer<typeof fileTreeResponseSchema>;
export type FileContentResponse = z.infer<typeof fileContentResponseSchema>;

export type FetchFileTreeOptions = {
  filter?: string;
  includeNoisyDirectories?: boolean;
  signal?: AbortSignal;
  workspaceRoot: string;
};

export type FetchFileContentOptions = {
  path: string;
  signal?: AbortSignal;
  workspaceRoot: string;
};

function formatApiMessage(body: unknown, fallbackMessage: string): string {
  const parsed = z.object({ message: z.string() }).safeParse(body);
  return parsed.success ? parsed.data.message : fallbackMessage;
}

export async function fetchFileTree(
  options: FetchFileTreeOptions,
): Promise<FileTreeResponse> {
  const url = new URL("/api/files/tree", window.location.origin);
  url.searchParams.set("workspaceRoot", options.workspaceRoot);
  if (options.filter?.trim()) {
    url.searchParams.set("filter", options.filter.trim());
  }
  if (options.includeNoisyDirectories) {
    url.searchParams.set("includeNoisyDirectories", "true");
  }

  const response = await apiFetch(
    `${url.pathname}${url.search}`,
    options.signal ? { signal: options.signal } : undefined,
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(formatApiMessage(body, "ファイルツリーの取得に失敗しました"));
  }

  return fileTreeResponseSchema.parse(body);
}

export async function fetchFileContent(
  options: FetchFileContentOptions,
): Promise<FileContentResponse> {
  const url = new URL("/api/files/content", window.location.origin);
  url.searchParams.set("workspaceRoot", options.workspaceRoot);
  url.searchParams.set("path", options.path);

  const response = await apiFetch(
    `${url.pathname}${url.search}`,
    options.signal ? { signal: options.signal } : undefined,
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(formatApiMessage(body, "ファイルの取得に失敗しました"));
  }

  return fileContentResponseSchema.parse(body);
}
