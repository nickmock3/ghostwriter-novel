import { describe, expect, it } from "vitest";
import { deriveReaderChapters } from "./readerChapters";

describe("deriveReaderChapters", () => {
  it("derives numbered novel chapters in chapter order and ignores non-chapter paths", () => {
    const chapters = deriveReaderChapters([
      { kind: "directory", path: "小説" },
      { kind: "directory", path: "小説/第010章" },
      { kind: "file", path: "小説/第010章/本文.txt" },
      { kind: "directory", path: "小説/第002章" },
      { kind: "file", path: "小説/第002章/本文.txt" },
      { kind: "directory", path: "小説/第001章" },
      { kind: "file", path: "小説/第001章/本文.txt" },
      { kind: "directory", path: "小説/第1章" },
      { kind: "file", path: "小説/第1章/本文.txt" },
      { kind: "directory", path: "小説/第ABC章" },
      { kind: "file", path: "メモ/第003章/本文.txt" },
    ]);

    expect(chapters.map((chapter) => chapter.directoryPath)).toEqual([
      "小説/第001章",
      "小説/第002章",
      "小説/第010章",
    ]);
    expect(chapters.map((chapter) => chapter.textPath)).toEqual([
      "小説/第001章/本文.txt",
      "小説/第002章/本文.txt",
      "小説/第010章/本文.txt",
    ]);
  });

  it("uses the first non-empty manuscript line as a title and falls back to the directory name", () => {
    const chapters = deriveReaderChapters(
      [
        { kind: "directory", path: "小説/第001章" },
        { kind: "file", path: "小説/第001章/本文.txt" },
        { kind: "directory", path: "小説/第002章" },
        { kind: "file", path: "小説/第002章/本文.txt" },
      ],
      {
        "小説/第001章/本文.txt": "\n\n第一章　星の港\n本文が続く",
        "小説/第002章/本文.txt": "   \n\t\n",
      },
    );

    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "第一章　星の港",
      "第002章",
    ]);
  });

  it("does not include chapter directories that do not contain 本文.txt", () => {
    const chapters = deriveReaderChapters([
      { kind: "directory", path: "小説/第001章" },
      { kind: "file", path: "小説/第001章/章内プロット.md" },
      { kind: "directory", path: "小説/第002章" },
      { kind: "file", path: "小説/第002章/本文.txt" },
    ]);

    expect(chapters.map((chapter) => chapter.directoryPath)).toEqual(["小説/第002章"]);
  });
});
