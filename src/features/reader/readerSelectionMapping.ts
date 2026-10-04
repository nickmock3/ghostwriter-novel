import { parseReaderInlineMarkup, type ReaderInlineToken } from "./readerMarkup";

type SourceUnit = {
  sourceEnd: number;
  sourceStart: number;
};

export type ReaderSelectionMap = {
  readonly sourceText: string;
  readonly visibleText: string;
  readonly visibleUnits: readonly SourceUnit[];
};

export type ReaderVisibleRange = {
  end: number;
  start: number;
};

function boundaryVisibleOffset(
  root: HTMLElement,
  node: Node | null,
  offset: number,
): number | null {
  if (!node || !root.contains(node)) {
    return null;
  }

  const boundaryElement = node instanceof Element ? node : node.parentElement;
  if (
    !boundaryElement ||
    boundaryElement.closest("[data-reader-selection-unsafe='true']") ||
    boundaryElement.closest(".reader-mode-manuscript-title")
  ) {
    return null;
  }

  const mappedElement = boundaryElement.closest<HTMLElement>("[data-reader-visible-start]");
  if (!mappedElement || !root.contains(mappedElement)) {
    return null;
  }

  const visibleStart = Number(mappedElement.dataset.readerVisibleStart);
  const visibleEnd = Number(mappedElement.dataset.readerVisibleEnd);
  if (!Number.isInteger(visibleStart) || !Number.isInteger(visibleEnd)) {
    return null;
  }

  const prefixRange = document.createRange();
  prefixRange.selectNodeContents(mappedElement);
  try {
    prefixRange.setEnd(node, offset);
  } catch {
    return null;
  }

  const localOffset = prefixRange.toString().length;
  return localOffset <= visibleEnd - visibleStart ? visibleStart + localOffset : null;
}

function appendVisibleUnits(
  visibleParts: string[],
  visibleUnits: SourceUnit[],
  text: string,
  sourceStart: number,
) {
  visibleParts.push(text);
  for (let index = 0; index < text.length; index += 1) {
    visibleUnits.push({
      sourceEnd: sourceStart + index + 1,
      sourceStart: sourceStart + index,
    });
  }
}

function appendAtomicVisibleUnits(
  visibleParts: string[],
  visibleUnits: SourceUnit[],
  text: string,
  sourceStart: number,
  sourceEnd: number,
) {
  visibleParts.push(text);
  for (let index = 0; index < text.length; index += 1) {
    visibleUnits.push({ sourceEnd, sourceStart });
  }
}

function consumeRubyToken(
  input: string,
  token: Extract<ReaderInlineToken, { kind: "ruby" }>,
  cursor: number,
) {
  const hasExplicitMarker = input[cursor] === "｜" || input[cursor] === "|";
  const baseStart = cursor + (hasExplicitMarker ? 1 : 0);
  const openBracket = baseStart + token.text.length;
  const closeBracket = openBracket + token.ruby.length + 1;

  if (
    input.slice(baseStart, openBracket) !== token.text ||
    input[openBracket] !== "《" ||
    input.slice(openBracket + 1, closeBracket) !== token.ruby ||
    input[closeBracket] !== "》"
  ) {
    return null;
  }

  return {
    sourceStart: cursor,
    sourceEnd: closeBracket + 1,
  };
}

function consumeEmphasisToken(
  input: string,
  token: Extract<ReaderInlineToken, { kind: "emphasis" }>,
  cursor: number,
) {
  const textStart = cursor + 2;
  const sourceEnd = textStart + token.text.length + 2;
  return input.startsWith("《《", cursor) &&
    input.slice(textStart, textStart + token.text.length) === token.text &&
    input.slice(sourceEnd - 2, sourceEnd) === "》》"
    ? { sourceEnd, sourceStart: cursor }
    : null;
}

function appendMappedLine(
  sourceText: string,
  sourceBase: number,
  visibleParts: string[],
  visibleUnits: SourceUnit[],
) {
  let sourceCursor = 0;

  for (const token of parseReaderInlineMarkup(sourceText)) {
    if (token.kind === "text") {
      appendVisibleUnits(visibleParts, visibleUnits, token.text, sourceBase + sourceCursor);
      sourceCursor += token.text.length;
      continue;
    }

    if (token.kind === "ruby") {
      const consumed = consumeRubyToken(sourceText, token, sourceCursor);
      if (consumed) {
        appendAtomicVisibleUnits(
          visibleParts,
          visibleUnits,
          token.text,
          sourceBase + consumed.sourceStart,
          sourceBase + consumed.sourceEnd,
        );
        sourceCursor = consumed.sourceEnd;
        continue;
      }
    } else {
      const consumed = consumeEmphasisToken(sourceText, token, sourceCursor);
      if (consumed) {
        appendAtomicVisibleUnits(
          visibleParts,
          visibleUnits,
          token.text,
          sourceBase + consumed.sourceStart,
          sourceBase + consumed.sourceEnd,
        );
        sourceCursor = consumed.sourceEnd;
        continue;
      }
    }

    const fallbackText = sourceText.slice(sourceCursor);
    appendVisibleUnits(visibleParts, visibleUnits, fallbackText, sourceBase + sourceCursor);
    sourceCursor = sourceText.length;
    break;
  }

  if (sourceCursor < sourceText.length) {
    const trailingText = sourceText.slice(sourceCursor);
    appendVisibleUnits(visibleParts, visibleUnits, trailingText, sourceBase + sourceCursor);
  }
}

export function createReaderSelectionMap(sourceText: string): ReaderSelectionMap {
  const visibleParts: string[] = [];
  const visibleUnits: SourceUnit[] = [];
  let lineStart = 0;

  while (lineStart <= sourceText.length) {
    const newlineIndex = sourceText.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? sourceText.length : newlineIndex;
    appendMappedLine(
      sourceText.slice(lineStart, lineEnd),
      lineStart,
      visibleParts,
      visibleUnits,
    );

    if (newlineIndex === -1) {
      break;
    }
    appendVisibleUnits(visibleParts, visibleUnits, "\n", newlineIndex);
    lineStart = newlineIndex + 1;
  }

  return {
    sourceText,
    visibleText: visibleParts.join(""),
    visibleUnits,
  };
}

export function mapReaderVisibleRangeToSource(
  mapping: ReaderSelectionMap,
  range: ReaderVisibleRange,
): ReaderVisibleRange | null {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    return null;
  }

  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  if (start < 0 || end > mapping.visibleUnits.length || start === end) {
    return null;
  }

  const firstUnit = mapping.visibleUnits[start];
  const lastUnit = mapping.visibleUnits[end - 1];
  if (!firstUnit || !lastUnit) {
    return null;
  }

  return {
    end: lastUnit.sourceEnd,
    start: firstUnit.sourceStart,
  };
}

export function mapReaderDomSelectionToSource(
  mapping: ReaderSelectionMap,
  selection: Selection | null,
  root: HTMLElement,
): ReaderVisibleRange | null {
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.anchorNode ||
    !selection.focusNode
  ) {
    return null;
  }

  const start = boundaryVisibleOffset(root, selection.anchorNode, selection.anchorOffset);
  const end = boundaryVisibleOffset(root, selection.focusNode, selection.focusOffset);
  if (start === null || end === null) {
    return null;
  }

  return mapReaderVisibleRangeToSource(mapping, { end, start });
}
