import { describe, expect, it } from "vitest";
import {
  createReaderSelectionMap,
  mapReaderVisibleRangeToSource,
} from "./readerSelectionMapping";

describe("reader selection source mapping", () => {
  it("maps plain visible text to the same source offsets", () => {
    const mapping = createReaderSelectionMap("前の文\n次の文");

    expect(mapping.visibleText).toBe("前の文\n次の文");
    expect(mapReaderVisibleRangeToSource(mapping, { end: 7, start: 4 })).toEqual({
      end: 7,
      start: 4,
    });
  });

  it("maps a visible explicit-ruby base to the complete source notation", () => {
    const mapping = createReaderSelectionMap("前｜漢字《かんじ》後");

    expect(mapping.visibleText).toBe("前漢字後");
    expect(mapReaderVisibleRangeToSource(mapping, { end: 3, start: 1 })).toEqual({
      end: 9,
      start: 1,
    });
  });

  it("maps implicit ruby and emphasis display text to complete source notation", () => {
    const mapping = createReaderSelectionMap("東京《とうきょう》と《《光》》");

    expect(mapping.visibleText).toBe("東京と光");
    expect(mapReaderVisibleRangeToSource(mapping, { end: 2, start: 0 })).toEqual({
      end: 9,
      start: 0,
    });
    expect(mapReaderVisibleRangeToSource(mapping, { end: 4, start: 3 })).toEqual({
      end: 15,
      start: 10,
    });
  });

  it("expands a partial decorated display selection to the complete notation", () => {
    const mapping = createReaderSelectionMap("前｜漢字《かんじ》後");

    expect(mapReaderVisibleRangeToSource(mapping, { end: 2, start: 1 })).toEqual({
      end: 9,
      start: 1,
    });
  });

  it("normalizes a backward visible selection and rejects an empty selection", () => {
    const mapping = createReaderSelectionMap("本文");

    expect(mapReaderVisibleRangeToSource(mapping, { end: 0, start: 2 })).toEqual({
      end: 2,
      start: 0,
    });
    expect(mapReaderVisibleRangeToSource(mapping, { end: 1, start: 1 })).toBeNull();
  });

  it("keeps UTF-16 offsets for surrogate pairs and selections spanning lines", () => {
    const mapping = createReaderSelectionMap("A😀B\n次");

    expect(mapping.visibleText).toBe("A😀B\n次");
    expect(mapReaderVisibleRangeToSource(mapping, { end: 3, start: 1 })).toEqual({
      end: 3,
      start: 1,
    });
    expect(mapReaderVisibleRangeToSource(mapping, { end: 6, start: 3 })).toEqual({
      end: 6,
      start: 3,
    });
  });

  it("maps half-width explicit ruby bases without relying on visible text search", () => {
    const mapping = createReaderSelectionMap("同じ|etc《えとせとら》同じ");

    expect(mapping.visibleText).toBe("同じetc同じ");
    expect(mapReaderVisibleRangeToSource(mapping, { end: 5, start: 2 })).toEqual({
      end: 13,
      start: 2,
    });
  });
});
