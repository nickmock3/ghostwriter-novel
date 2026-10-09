import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { resolveRipgrepExecutable, type RuntimeEnv } from "../../shared/server/runtimeConfig";
import {
  resolveWorkspaceFilePath,
  toWorkspaceRelativePath,
} from "./workspaceFilePaths";
import { resolveWorkspaceRoot } from "./workspacePaths";
export type WorkspaceGlobInput = { pattern: string };
export type WorkspaceGlobOutput = {
  limit: number;
  matches: string[];
  truncated: boolean;
};
export type WorkspaceGrepInput = {
  query: string;
  options?: { glob?: string; path?: string };
};
export type WorkspaceGrepOutput = {
  limit: number;
  matches: { line: string; lineNumber: number; path: string }[];
  truncated: boolean;
};
export type WorkspaceSearchInput = { query: string };
export type WorkspaceSearchOutput = {
  limit: number;
  queryTerms: string[];
  results: { lineNumber: number; path: string; score: number; snippet: string }[];
  truncated: boolean;
};

const MAX_SEARCH_RESULTS = 10;

export type WorkspaceSearchContext = {
  readonly workspaceRoot: string;
};

export type WorkspaceSearchStore = {
  createContext(workspaceRoot: string): Promise<WorkspaceSearchContext>;
  glob(
    context: WorkspaceSearchContext,
    input: WorkspaceGlobInput,
  ): Promise<WorkspaceGlobOutput>;
  grep(
    context: WorkspaceSearchContext,
    input: WorkspaceGrepInput,
  ): Promise<WorkspaceGrepOutput>;
  search(
    context: WorkspaceSearchContext,
    input: WorkspaceSearchInput,
  ): Promise<WorkspaceSearchOutput>;
};

type RgResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type GrepMatch = {
  line: string;
  lineNumber: number;
  path: string;
};

export type RunRgCommand = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<RgResult>;

export type LocalWorkspaceSearchStoreOptions = {
  env?: RuntimeEnv;
  rgExecutable?: string;
  runCommand?: RunRgCommand;
};

function defaultRunRg(command: string, args: string[], cwd: string): Promise<RgResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      });
    });
  });
}

function ensureRgSuccess(result: RgResult): void {
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(result.stderr.trim() || "ripgrep failed");
  }
}

function toWorkspacePath(filePath: string): string {
  return toWorkspaceRelativePath(filePath);
}

async function isSafeWorkspaceEntry(workspaceRoot: string, workspaceRelativePath: string): Promise<boolean> {
  try {
    await resolveWorkspaceFilePath(workspaceRoot, workspaceRelativePath, {
      requireExisting: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function filterSafeWorkspaceEntries(
  workspaceRoot: string,
  workspaceRelativePaths: string[],
): Promise<string[]> {
  const safetyChecks = await Promise.all(
    workspaceRelativePaths.map(async (entryPath) => ({
      entryPath,
      isSafe: await isSafeWorkspaceEntry(workspaceRoot, entryPath),
    })),
  );

  return safetyChecks.filter((check) => check.isSafe).map((check) => check.entryPath);
}

async function listWorkspaceDirectories(workspaceRoot: string): Promise<string[]> {
  const directories: string[] = [];

  async function walk(relativeDirectoryPath: string): Promise<void> {
    const absoluteDirectoryPath = path.join(workspaceRoot, relativeDirectoryPath);
    const entries = await readdir(absoluteDirectoryPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }

      const relativePath = toWorkspacePath(path.join(relativeDirectoryPath, entry.name));
      if (!(await isSafeWorkspaceEntry(workspaceRoot, relativePath))) {
        continue;
      }

      directories.push(relativePath);
      await walk(relativePath);
    }
  }

  await walk("");
  return directories;
}

function escapeRegex(pattern: string): string {
  return pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globPatternToRegex(pattern: string): RegExp {
  const normalizedPattern = pattern.replace(/\\/g, "/");
  let source = "";

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    const nextCharacter = normalizedPattern[index + 1];

    if (character === "*" && nextCharacter === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(character);
    }
  }

  return new RegExp(`^${source}$`);
}

function matchesGlobPattern(workspaceRelativePath: string, pattern: string): boolean {
  const normalizedPath = toWorkspaceRelativePath(workspaceRelativePath);
  const normalizedPattern = pattern.replace(/\\/g, "/");
  const regex = globPatternToRegex(pattern);

  if (regex.test(normalizedPath)) {
    return true;
  }

  if (!normalizedPattern.includes("/") && regex.test(path.posix.basename(normalizedPath))) {
    return true;
  }

  return false;
}

function parseGrepLine(line: string): GrepMatch | null {
  const match = /^(.*?):(\d+):(.*)$/.exec(line);
  if (!match) {
    return null;
  }

  return {
    line: match[3],
    lineNumber: Number.parseInt(match[2], 10),
    path: toWorkspaceRelativePath(match[1]),
  };
}

const stopWords = new Set([
  "about",
  "does",
  "file",
  "files",
  "from",
  "have",
  "into",
  "that",
  "the",
  "this",
  "what",
  "when",
  "where",
  "with",
]);

function extractQueryTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9_./-]{3,}/g)
    ?.filter((term) => !stopWords.has(term));

  return Array.from(new Set(terms ?? [])).slice(0, 5);
}

function scoreMatch(match: GrepMatch, terms: string[]): number {
  const haystack = `${match.path} ${match.line}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

export function createLocalWorkspaceSearchStore(
  options: LocalWorkspaceSearchStoreOptions = {},
): WorkspaceSearchStore {
  const env = options.env ?? process.env;
  const rgExecutable = options.rgExecutable ?? resolveRipgrepExecutable(env);
  const runCommand = options.runCommand ?? defaultRunRg;

  async function runRg(args: string[], cwd: string): Promise<RgResult> {
    return runCommand(rgExecutable, args, cwd);
  }

  async function createContext(workspaceRoot: string): Promise<WorkspaceSearchContext> {
    const resolvedWorkspaceRoot = await resolveWorkspaceRoot(workspaceRoot);
    return { workspaceRoot: resolvedWorkspaceRoot };
  }

  async function glob(
    context: WorkspaceSearchContext,
    input: WorkspaceGlobInput,
  ): Promise<WorkspaceGlobOutput> {
    const result = await runRg(["--files"], context.workspaceRoot);
    ensureRgSuccess(result);

    const filePaths = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(toWorkspacePath);
    const directoryPaths = await listWorkspaceDirectories(context.workspaceRoot);
    const safePaths = await filterSafeWorkspaceEntries(context.workspaceRoot, [
      ...filePaths,
      ...directoryPaths,
    ]);
    const paths = Array.from(new Set(safePaths))
      .filter((entryPath) => matchesGlobPattern(entryPath, input.pattern))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, MAX_SEARCH_RESULTS + 1);

    return {
      limit: MAX_SEARCH_RESULTS,
      matches: paths.slice(0, MAX_SEARCH_RESULTS),
      truncated: paths.length > MAX_SEARCH_RESULTS,
    };
  }

  async function grep(
    context: WorkspaceSearchContext,
    input: WorkspaceGrepInput,
  ): Promise<WorkspaceGrepOutput> {
    const args = [
      "--line-number",
      "--with-filename",
      "--color",
      "never",
      "--fixed-strings",
    ];

    if (input.options?.glob) {
      args.push("--glob", input.options.glob.replace(/\\/g, "/"));
    }

    if (input.options?.path) {
      const resolved = await resolveWorkspaceFilePath(context.workspaceRoot, input.options.path, {
        requireExisting: true,
      });
      args.push("--", input.query, resolved.workspaceRelativePath);
    } else {
      args.push("--", input.query);
    }

    const result = await runRg(args, context.workspaceRoot);
    ensureRgSuccess(result);
    const parsedMatches = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseGrepLine)
      .filter((match): match is GrepMatch => match !== null);
    const safePaths = new Set(
      await filterSafeWorkspaceEntries(
        context.workspaceRoot,
        parsedMatches.map((match) => match.path),
      ),
    );
    const matches = parsedMatches
      .filter((match) => safePaths.has(match.path))
      .slice(0, MAX_SEARCH_RESULTS + 1);

    return {
      limit: MAX_SEARCH_RESULTS,
      matches: matches.slice(0, MAX_SEARCH_RESULTS),
      truncated: matches.length > MAX_SEARCH_RESULTS,
    };
  }

  async function search(
    context: WorkspaceSearchContext,
    input: WorkspaceSearchInput,
  ): Promise<WorkspaceSearchOutput> {
    const queryTerms = extractQueryTerms(input.query);
    const rankedMatches = new Map<string, GrepMatch & { score: number }>();

    for (const term of queryTerms) {
      const grepResult = await grep(context, { query: term });

      for (const match of grepResult.matches) {
        const key = `${match.path}:${match.lineNumber}`;
        const score = scoreMatch(match, queryTerms);
        const existing = rankedMatches.get(key);
        if (!existing || score > existing.score) {
          rankedMatches.set(key, { ...match, score });
        }
      }
    }

    const results = Array.from(rankedMatches.values())
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, MAX_SEARCH_RESULTS + 1);

    return {
      limit: MAX_SEARCH_RESULTS,
      queryTerms,
      results: results.slice(0, MAX_SEARCH_RESULTS).map((result) => ({
        lineNumber: result.lineNumber,
        path: result.path,
        score: result.score,
        snippet: result.line,
      })),
      truncated: results.length > MAX_SEARCH_RESULTS,
    };
  }

  return {
    createContext,
    glob,
    grep,
    search,
  };
}

export const localWorkspaceSearchStore = createLocalWorkspaceSearchStore();
