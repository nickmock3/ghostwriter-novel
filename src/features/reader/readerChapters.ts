export type WorkspaceTreeItem = {
  kind: "directory" | "file";
  path: string;
};

export type ReaderChapter = {
  chapterNumber: number;
  directoryPath: string;
  textPath: string;
  title: string;
};

const CHAPTER_DIRECTORY_PATTERN = /^小説\/第(\d{3,})章$/;
const CHAPTER_TEXT_PATH_PATTERN = /^小説\/第(\d{3,})章\/本文\.txt$/;

function directoryNameFromPath(directoryPath: string): string {
  const segments = directoryPath.split("/");
  return segments[segments.length - 1] ?? directoryPath;
}

function firstNonEmptyLine(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length > 0) {
      return line.trim();
    }
  }

  return null;
}

function chapterTitle(content: string | undefined, directoryPath: string): string {
  if (content !== undefined) {
    const line = firstNonEmptyLine(content);
    if (line) {
      return line;
    }
  }

  return directoryNameFromPath(directoryPath);
}

export function deriveReaderChapters(
  items: WorkspaceTreeItem[],
  contentsByPath?: Record<string, string>,
): ReaderChapter[] {
  const chapters: ReaderChapter[] = [];

  for (const item of items) {
    if (item.kind !== "file") {
      continue;
    }

    const match = item.path.match(CHAPTER_TEXT_PATH_PATTERN);
    if (!match) {
      continue;
    }

    const chapterDigits = match[1];
    const directoryPath = `小説/第${chapterDigits}章`;
    if (!CHAPTER_DIRECTORY_PATTERN.test(directoryPath)) {
      continue;
    }

    chapters.push({
      chapterNumber: Number.parseInt(chapterDigits, 10),
      directoryPath,
      textPath: item.path,
      title: chapterTitle(contentsByPath?.[item.path], directoryPath),
    });
  }

  chapters.sort((left, right) => left.chapterNumber - right.chapterNumber);
  return chapters;
}
