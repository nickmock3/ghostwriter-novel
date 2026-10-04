import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as workspaceChangedNotifier from "../workspace/workspaceChangedNotifier";
import {
  applyEditProposal,
  createDirectoryProposalForWorkspace,
  createFileProposalForWorkspace,
  createEditProposalForWorkspace,
  rejectEditProposal,
  undoEditProposal,
} from "./editProposalService";

function createWorkspace() {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), "ghostwriter-edit-"));
  return {
    cleanup: () => rmSync(workspaceRoot, { force: true, recursive: true }),
    workspaceRoot,
  };
}

describe("edit proposal service", () => {
  it("creates a pending proposal for a single exact replacement without writing the file", async () => {
    const workspace = createWorkspace();
    try {
      const filePath = path.join(workspace.workspaceRoot, "note.txt");
      writeFileSync(filePath, "hello old text\n", "utf8");

      const proposal = await createEditProposalForWorkspace({
        newText: "new text",
        oldText: "old text",
        path: "note.txt",
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(proposal.status).toBe("pending");
      expect(proposal.diff).toContain("-old text");
      expect(proposal.diff).toContain("+new text");
      expect(readFileSync(filePath, "utf8")).toBe("hello old text\n");
    } finally {
      workspace.cleanup();
    }
  });

  it("creates a pending edit proposal for an empty file without writing it", async () => {
    const workspace = createWorkspace();
    try {
      const filePath = path.join(workspace.workspaceRoot, "empty.txt");
      writeFileSync(filePath, "", "utf8");

      const proposal = await createEditProposalForWorkspace({
        newText: "first line\n",
        oldText: "",
        path: "empty.txt",
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(proposal).toMatchObject({
        newText: "first line\n",
        oldText: "",
        operation: "edit",
        path: "empty.txt",
        status: "pending",
        title: "Edit empty.txt",
      });
      expect(proposal.diff).toContain("--- empty.txt");
      expect(proposal.diff).toContain("+++ empty.txt");
      expect(proposal.diff).toContain("+first line");
      expect(readFileSync(filePath, "utf8")).toBe("");
    } finally {
      workspace.cleanup();
    }
  });

  it("creates a pending proposal for a new file without writing it", async () => {
    const workspace = createWorkspace();
    try {
      mkdirSync(path.join(workspace.workspaceRoot, "docs"));
      const filePath = path.join(workspace.workspaceRoot, "docs", "new.md");

      const proposal = await createFileProposalForWorkspace({
        content: "# New file\n",
        path: "docs/new.md",
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(proposal).toMatchObject({
        newText: "# New file\n",
        oldText: "",
        operation: "create",
        path: "docs/new.md",
        status: "pending",
        title: "Create docs/new.md",
      });
      expect(proposal.diff).toContain("--- /dev/null");
      expect(proposal.diff).toContain("+++ docs/new.md");
      expect(() => readFileSync(filePath, "utf8")).toThrow();
    } finally {
      workspace.cleanup();
    }
  });

  it("does not recreate a removed parent directory when applying a create proposal", async () => {
    const workspace = createWorkspace();
    try {
      const parentPath = path.join(workspace.workspaceRoot, "docs");
      mkdirSync(parentPath);
      const proposal = await createFileProposalForWorkspace({
        content: "new scene",
        path: "docs/scene.txt",
        workspaceRoot: workspace.workspaceRoot,
      });
      rmSync(parentPath, { recursive: true });

      const result = await applyEditProposal({
        dirtyPaths: [],
        proposal,
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(result.status).toBe("conflicted");
      expect(existsSync(parentPath)).toBe(false);
    } finally {
      workspace.cleanup();
    }
  });

  it("creates a pending proposal for a new directory without writing it", async () => {
    const workspace = createWorkspace();
    try {
      const directoryPath = path.join(workspace.workspaceRoot, "docs");

      const proposal = await createDirectoryProposalForWorkspace({
        path: "docs",
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(proposal).toMatchObject({
        newText: "",
        oldText: "",
        operation: "createDirectory",
        path: "docs",
        status: "pending",
        title: "Create directory docs",
      });
      expect(proposal.diff).toContain("+++ docs/");
      expect(existsSync(directoryPath)).toBe(false);
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects ambiguous replacements", async () => {
    const workspace = createWorkspace();
    try {
      writeFileSync(path.join(workspace.workspaceRoot, "note.txt"), "same\nsame\n", "utf8");

      await expect(
        createEditProposalForWorkspace({
          newText: "changed",
          oldText: "same",
          path: "note.txt",
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("exactly once");
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects empty oldText edit proposals for non-empty files", async () => {
    const workspace = createWorkspace();
    try {
      writeFileSync(path.join(workspace.workspaceRoot, "note.txt"), "already has content", "utf8");

      await expect(
        createEditProposalForWorkspace({
          newText: "new",
          oldText: "",
          path: "note.txt",
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("empty file");
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects proposals and apply attempts for hidden path segments", async () => {
    const workspace = createWorkspace();
    try {
      mkdirSync(path.join(workspace.workspaceRoot, ".hidden"));
      writeFileSync(path.join(workspace.workspaceRoot, ".hidden", "note.txt"), "old", "utf8");

      await expect(
        createEditProposalForWorkspace({
          newText: "new",
          oldText: "old",
          path: ".hidden/note.txt",
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("Hidden path segments");

      await expect(
        applyEditProposal({
          dirtyPaths: [],
          proposal: {
            createdAt: "2026-05-09T00:00:00.000Z",
            diff: "",
            id: "proposal-1",
            newText: "new",
            oldText: "old",
            operation: "edit",
            path: ".hidden/note.txt",
            status: "pending",
            title: "Edit .hidden/note.txt",
            updatedAt: "2026-05-09T00:00:00.000Z",
          },
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("Hidden path segments");
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects create proposals for existing files", async () => {
    const workspace = createWorkspace();
    try {
      writeFileSync(path.join(workspace.workspaceRoot, "note.txt"), "already exists", "utf8");

      await expect(
        createFileProposalForWorkspace({
          content: "new",
          path: "note.txt",
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("already exists");
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects create-file proposals when the parent directory does not exist", async () => {
    const workspace = createWorkspace();
    try {
      await expect(
        createFileProposalForWorkspace({
          content: "new scene",
          path: "missing/scene.txt",
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("Parent directory does not exist");
      expect(existsSync(path.join(workspace.workspaceRoot, "missing"))).toBe(false);
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects create-file proposals when the parent path is a regular file", async () => {
    const workspace = createWorkspace();
    try {
      writeFileSync(path.join(workspace.workspaceRoot, "parent.txt"), "not a directory", "utf8");
      await expect(
        createFileProposalForWorkspace({
          content: "new scene",
          path: "parent.txt/child.txt",
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("Parent directory does not exist");
    } finally {
      workspace.cleanup();
    }
  });

  it("rejects directory proposals for existing paths and missing parents", async () => {
    const workspace = createWorkspace();
    try {
      mkdirSync(path.join(workspace.workspaceRoot, "existing"));

      await expect(
        createDirectoryProposalForWorkspace({
          path: "existing",
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("already exists");

      await expect(
        createDirectoryProposalForWorkspace({
          path: "missing/child",
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("Parent directory does not exist");
    } finally {
      workspace.cleanup();
    }
  });

  it("applies one pending proposal after re-reading the file", async () => {
    const workspace = createWorkspace();
    try {
      const filePath = path.join(workspace.workspaceRoot, "note.txt");
      writeFileSync(filePath, "before old after", "utf8");

      const result = await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-09T00:00:00.000Z",
          diff: "",
          id: "proposal-1",
          newText: "new",
          oldText: "old",
          operation: "edit",
          path: "note.txt",
          status: "pending",
          title: "Edit note.txt",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(result.status).toBe("applied");
      expect(readFileSync(filePath, "utf8")).toBe("before new after");
    } finally {
      workspace.cleanup();
    }
  });

  it("applies an empty-file edit proposal only when the file is still empty", async () => {
    const workspace = createWorkspace();
    try {
      const filePath = path.join(workspace.workspaceRoot, "empty.txt");
      writeFileSync(filePath, "", "utf8");

      const result = await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-09T00:00:00.000Z",
          diff: "",
          id: "proposal-1",
          newText: "first line\n",
          oldText: "",
          operation: "edit",
          path: "empty.txt",
          status: "pending",
          title: "Edit empty.txt",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(result.status).toBe("applied");
      expect(readFileSync(filePath, "utf8")).toBe("first line\n");
    } finally {
      workspace.cleanup();
    }
  });

  it("does not undo a created directory when it contains new files", async () => {
    const workspace = createWorkspace();
    try {
      const proposal = await createDirectoryProposalForWorkspace({
        path: "docs",
        workspaceRoot: workspace.workspaceRoot,
      });
      const applied = await applyEditProposal({
        dirtyPaths: [],
        proposal,
        workspaceRoot: workspace.workspaceRoot,
      });
      writeFileSync(path.join(workspace.workspaceRoot, "docs", "note.txt"), "user change", "utf8");

      const undone = await undoEditProposal({
        proposal: applied,
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(undone.status).toBe("conflicted");
      expect(readFileSync(path.join(workspace.workspaceRoot, "docs", "note.txt"), "utf8")).toBe("user change");
    } finally {
      workspace.cleanup();
    }
  });

  it("marks empty-file edit proposals as conflict when content appears before apply", async () => {
    const workspace = createWorkspace();
    try {
      const filePath = path.join(workspace.workspaceRoot, "empty.txt");
      writeFileSync(filePath, "changed elsewhere", "utf8");

      const result = await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-09T00:00:00.000Z",
          diff: "",
          id: "proposal-1",
          newText: "first line\n",
          oldText: "",
          operation: "edit",
          path: "empty.txt",
          status: "pending",
          title: "Edit empty.txt",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(result.status).toBe("conflicted");
      expect(readFileSync(filePath, "utf8")).toBe("changed elsewhere");
    } finally {
      workspace.cleanup();
    }
  });

  it("applies a pending create proposal by writing the new file once", async () => {
    const workspace = createWorkspace();
    try {
      mkdirSync(path.join(workspace.workspaceRoot, "docs"));
      const result = await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-09T00:00:00.000Z",
          diff: "",
          id: "proposal-1",
          newText: "# New file\n",
          oldText: "",
          operation: "create",
          path: "docs/new.md",
          status: "pending",
          title: "Create docs/new.md",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(result.status).toBe("applied");
      expect(readFileSync(path.join(workspace.workspaceRoot, "docs", "new.md"), "utf8")).toBe(
        "# New file\n",
      );
    } finally {
      workspace.cleanup();
    }
  });

  it("notifies workspace changed after applying create and directory proposals", async () => {
    const workspace = createWorkspace();
    const notify = vi.spyOn(workspaceChangedNotifier, "notifyWorkspaceChanged");

    try {
      await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-12T00:00:00.000Z",
          diff: "",
          id: "proposal-file",
          newText: "hello",
          oldText: "",
          operation: "create",
          path: "docs.md",
          status: "pending",
          title: "Create docs.md",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });
      await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-12T00:00:00.000Z",
          diff: "",
          id: "proposal-dir",
          newText: "",
          oldText: "",
          operation: "createDirectory",
          path: "docs",
          status: "pending",
          title: "Create directory docs",
          updatedAt: "2026-05-12T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(notify).toHaveBeenCalledTimes(2);
      expect(notify).toHaveBeenCalledWith(workspace.workspaceRoot);
    } finally {
      notify.mockRestore();
      workspace.cleanup();
    }
  });

  it("applies a pending directory proposal only when the target is still absent", async () => {
    const workspace = createWorkspace();
    try {
      const result = await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-09T00:00:00.000Z",
          diff: "",
          id: "proposal-1",
          newText: "",
          oldText: "",
          operation: "createDirectory",
          path: "docs",
          status: "pending",
          title: "Create directory docs",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(result.status).toBe("applied");
      expect(existsSync(path.join(workspace.workspaceRoot, "docs"))).toBe(true);
    } finally {
      workspace.cleanup();
    }
  });

  it("marks directory proposals as conflict when the target appears before apply", async () => {
    const workspace = createWorkspace();
    try {
      mkdirSync(path.join(workspace.workspaceRoot, "docs"));

      const result = await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-09T00:00:00.000Z",
          diff: "",
          id: "proposal-1",
          newText: "",
          oldText: "",
          operation: "createDirectory",
          path: "docs",
          status: "pending",
          title: "Create directory docs",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(result.status).toBe("conflicted");
    } finally {
      workspace.cleanup();
    }
  });

  it("marks create proposals as conflict when the target appears before apply", async () => {
    const workspace = createWorkspace();
    try {
      writeFileSync(path.join(workspace.workspaceRoot, "docs.md"), "existing", "utf8");

      const result = await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-09T00:00:00.000Z",
          diff: "",
          id: "proposal-1",
          newText: "new",
          oldText: "",
          operation: "create",
          path: "docs.md",
          status: "pending",
          title: "Create docs.md",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(result.status).toBe("conflicted");
      expect(readFileSync(path.join(workspace.workspaceRoot, "docs.md"), "utf8")).toBe("existing");
    } finally {
      workspace.cleanup();
    }
  });

  it("reports conflict when the old text no longer matches at apply time", async () => {
    const workspace = createWorkspace();
    try {
      writeFileSync(path.join(workspace.workspaceRoot, "note.txt"), "changed elsewhere", "utf8");

      const result = await applyEditProposal({
        dirtyPaths: [],
        proposal: {
          createdAt: "2026-05-09T00:00:00.000Z",
          diff: "",
          id: "proposal-1",
          newText: "new",
          oldText: "old",
          operation: "edit",
          path: "note.txt",
          status: "pending",
          title: "Edit note.txt",
          updatedAt: "2026-05-09T00:00:00.000Z",
        },
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(result.status).toBe("conflicted");
    } finally {
      workspace.cleanup();
    }
  });

  it("blocks apply when the target file has unsaved editor changes", async () => {
    const workspace = createWorkspace();
    try {
      writeFileSync(path.join(workspace.workspaceRoot, "note.txt"), "old", "utf8");

      await expect(
        applyEditProposal({
          dirtyPaths: ["note.txt"],
          proposal: {
            createdAt: "2026-05-09T00:00:00.000Z",
            diff: "",
            id: "proposal-1",
            newText: "new",
            oldText: "old",
            operation: "edit",
            path: "note.txt",
            status: "pending",
            title: "Edit note.txt",
            updatedAt: "2026-05-09T00:00:00.000Z",
          },
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("unsaved");
    } finally {
      workspace.cleanup();
    }
  });

  it("treats Windows-style proposal and dirty paths as the same normalized file", async () => {
    const workspace = createWorkspace();
    try {
      mkdirSync(path.join(workspace.workspaceRoot, "docs"));
      writeFileSync(path.join(workspace.workspaceRoot, "docs", "note.txt"), "old", "utf8");

      const proposal = await createEditProposalForWorkspace({
        newText: "new",
        oldText: "old",
        path: "docs\\note.txt",
        workspaceRoot: workspace.workspaceRoot,
      });

      expect(proposal.path).toBe("docs/note.txt");
      await expect(
        applyEditProposal({
          dirtyPaths: ["docs\\note.txt"],
          proposal,
          workspaceRoot: workspace.workspaceRoot,
        }),
      ).rejects.toThrow("unsaved");
    } finally {
      workspace.cleanup();
    }
  });

  it("marks a pending proposal as rejected without writing the file", () => {
    const result = rejectEditProposal({
      createdAt: "2026-05-09T00:00:00.000Z",
      diff: "",
      id: "proposal-1",
      newText: "new",
      oldText: "old",
      operation: "edit",
      path: "note.txt",
      status: "pending",
      title: "Edit note.txt",
      updatedAt: "2026-05-09T00:00:00.000Z",
    });

    expect(result.status).toBe("rejected");
  });
});
