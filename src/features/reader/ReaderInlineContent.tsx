import type { ReactNode } from "react";
import { parseReaderInlineMarkup, type ReaderInlineToken } from "./readerMarkup";

function mappedText(
  text: string,
  key: string,
  visibleStart: number,
  className?: string,
) {
  return (
    <span
      className={className}
      data-reader-visible-end={visibleStart + text.length}
      data-reader-visible-start={visibleStart}
      key={key}
    >
      {text}
    </span>
  );
}

function renderToken(token: ReaderInlineToken, key: string, visibleStart: number): ReactNode {
  switch (token.kind) {
    case "text":
      return mappedText(token.text, key, visibleStart);
    case "ruby":
      return (
        <ruby key={key}>
          {mappedText(token.text, `${key}:base`, visibleStart)}
          <rt data-reader-selection-unsafe="true">{token.ruby}</rt>
        </ruby>
      );
    case "emphasis":
      return mappedText(token.text, key, visibleStart, "reader-mode-emphasis");
  }
}

type ReaderInlineContentProps = {
  text: string;
  keyPrefix: string;
  visibleStart?: number;
};

export function ReaderInlineContent({ text, keyPrefix, visibleStart = 0 }: ReaderInlineContentProps) {
  const tokens = parseReaderInlineMarkup(text);
  let tokenVisibleStart = visibleStart;
  return tokens.map((token, index) => {
    const rendered = renderToken(token, `${keyPrefix}:${index}`, tokenVisibleStart);
    tokenVisibleStart += token.text.length;
    return rendered;
  });
}
