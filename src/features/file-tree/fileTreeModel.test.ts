import { describe, expect, it } from "vitest";
import {
  buildChildPath,
  buildRenamePath,
  buildTree,
  clampActionMenuPosition,
  flattenVisibleTree,
  getFileDropTarget,
  validateOperationName,
} from "./fileTreeModel";

describe("fileTreeModel", () => {
  it("builds a sorted hierarchy and infers missing parent directories", () => {
    expect(
      buildTree([
        { kind: "file", path: "src/z.ts" },
        { kind: "file", path: "README.md" },
        { kind: "file", path: "src/components/App.tsx" },
        { kind: "directory", path: "docs" },
      ]),
    ).toEqual([
      {
        children: [
          {
            children: [{ children: [], kind: "file", name: "App.tsx", path: "src/components/App.tsx" }],
            kind: "directory",
            name: "components",
            path: "src/components",
          },
          { children: [], kind: "file", name: "z.ts", path: "src/z.ts" },
        ],
        kind: "directory",
        name: "src",
        path: "src",
      },
      { children: [], kind: "directory", name: "docs", path: "docs" },
      { children: [], kind: "file", name: "README.md", path: "README.md" },
    ]);
  });

  it("honors collapsed directories except while filtering", () => {
    const nodes = buildTree([{ kind: "file", path: "src/features/App.tsx" }]);

    expect(
      flattenVisibleTree(nodes, new Set(["src"]), false).map(({ depth, node }) => [node.path, depth]),
    ).toEqual([["src", 0]]);
    expect(
      flattenVisibleTree(nodes, new Set(["src"]), true).map(({ depth, node }) => [node.path, depth]),
    ).toEqual([
      ["src", 0],
      ["src/features", 1],
      ["src/features/App.tsx", 2],
    ]);
  });

  it("builds operation paths and validates file or directory names", () => {
    expect(buildChildPath("src", "new.ts")).toBe("src/new.ts");
    expect(buildChildPath("", "new.ts")).toBe("new.ts");
    expect(buildRenamePath("src/features/App.tsx", "Renamed.tsx")).toBe(
      "src/features/Renamed.tsx",
    );
    expect(validateOperationName("  ")).toBe("名前を入力してください");
    expect(validateOperationName("nested/name.ts")).toBe("名前に / は使えません");
    expect(validateOperationName(" name.md ")).toBeNull();
  });

  it("keeps action menus inside the viewport margins", () => {
    expect(clampActionMenuPosition(300, 300, { height: 180, width: 200 })).toEqual({
      x: 12,
      y: 12,
    });
    expect(clampActionMenuPosition(-1, -1, { height: 900, width: 1000 })).toEqual({
      x: 8,
      y: 8,
    });
  });

  it("offers a drop target only between file siblings with the same parent", () => {
    const [rootA, rootB] = buildTree([
      { kind: "file", path: "A.txt" },
      { kind: "file", path: "B.txt" },
    ]);
    const [directory] = buildTree([{ kind: "directory", path: "docs" }]);
    const [nestedDirectory] = buildTree([{ kind: "file", path: "docs/C.txt" }]);

    expect(
      getFileDropTarget(
        { node: rootA! },
        { node: rootB! },
      ),
    ).toEqual({ insertBeforePath: "B.txt", parentPath: "" });
    expect(
      getFileDropTarget(
        { node: directory! },
        { node: rootB! },
      ),
    ).toBeNull();
    expect(
      getFileDropTarget(
        { node: rootA! },
        { node: nestedDirectory!.children[0]! },
      ),
    ).toBeNull();
  });
});
