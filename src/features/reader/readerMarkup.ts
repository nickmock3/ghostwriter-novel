export type ReaderInlineToken =
  | { kind: "text"; text: string }
  | { kind: "ruby"; text: string; ruby: string }
  | { kind: "emphasis"; text: string };

const KANJI_CHAR_RE = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF々〆ヵヶ]/u;

function isKanjiChar(character: string): boolean {
  return KANJI_CHAR_RE.test(character);
}

function kanjiRunStart(input: string, beforeIndex: number): number {
  let index = beforeIndex - 1;
  while (index >= 0 && isKanjiChar(input[index] ?? "")) {
    index -= 1;
  }
  return index + 1;
}

export function parseReaderInlineMarkup(input: string): ReaderInlineToken[] {
  const tokens: ReaderInlineToken[] = [];
  let textBuffer = "";

  function flushText() {
    if (textBuffer.length > 0) {
      tokens.push({ kind: "text", text: textBuffer });
      textBuffer = "";
    }
  }

  let index = 0;
  while (index < input.length) {
    if (input.startsWith("《《", index)) {
      const closeIndex = input.indexOf("》》", index + 2);
      if (closeIndex !== -1) {
        flushText();
        tokens.push({ kind: "emphasis", text: input.slice(index + 2, closeIndex) });
        index = closeIndex + 2;
        continue;
      }
    }

    if (input[index] === "｜" || input[index] === "|") {
      const openBracket = input.indexOf("《", index + 1);
      if (openBracket !== -1) {
        const closeBracket = input.indexOf("》", openBracket + 1);
        if (closeBracket !== -1) {
          const base = input.slice(index + 1, openBracket);
          const ruby = input.slice(openBracket + 1, closeBracket);
          if (base.length > 0 && ruby.length > 0) {
            flushText();
            tokens.push({ kind: "ruby", text: base, ruby });
            index = closeBracket + 1;
            continue;
          }
        }
      }
    }

    if (input[index] === "《" && !input.startsWith("《《", index)) {
      const runStart = kanjiRunStart(input, index);
      const kanjiRun = input.slice(runStart, index);
      const closeBracket = input.indexOf("》", index + 1);
      if (kanjiRun.length > 0 && closeBracket !== -1) {
        const ruby = input.slice(index + 1, closeBracket);
        if (ruby.length > 0) {
          textBuffer = textBuffer.slice(0, textBuffer.length - kanjiRun.length);
          flushText();
          tokens.push({ kind: "ruby", text: kanjiRun, ruby });
          index = closeBracket + 1;
          continue;
        }
      }
    }

    textBuffer += input[index];
    index += 1;
  }

  flushText();
  return tokens;
}
