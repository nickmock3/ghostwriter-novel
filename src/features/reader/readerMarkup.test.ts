import { describe, expect, it } from "vitest";
import { parseReaderInlineMarkup } from "./readerMarkup";

describe("parseReaderInlineMarkup", () => {
  it("parses explicit full-width and half-width ruby markers", () => {
    expect(parseReaderInlineMarkup("｜山田太郎《やまだたろう》と|etc《えとせとら》")).toEqual([
      { kind: "ruby", text: "山田太郎", ruby: "やまだたろう" },
      { kind: "text", text: "と" },
      { kind: "ruby", text: "etc", ruby: "えとせとら" },
    ]);
  });

  it("parses implicit kanji ruby", () => {
    expect(parseReaderInlineMarkup("山田太郎《やまだたろう》が来た")).toEqual([
      { kind: "ruby", text: "山田太郎", ruby: "やまだたろう" },
      { kind: "text", text: "が来た" },
    ]);
  });

  it("parses emphasis before ruby so emphasis markup is not treated as ruby", () => {
    expect(parseReaderInlineMarkup("これは《《重要》》です。")).toEqual([
      { kind: "text", text: "これは" },
      { kind: "emphasis", text: "重要" },
      { kind: "text", text: "です。" },
    ]);
  });

  it("keeps unsupported or ambiguous markup as plain text", () => {
    expect(parseReaderInlineMarkup("abc《えーびーしー》と山田太郎《》")).toEqual([
      { kind: "text", text: "abc《えーびーしー》と山田太郎《》" },
    ]);
  });
});
