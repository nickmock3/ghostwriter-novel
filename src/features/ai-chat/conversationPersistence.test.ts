import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import {
  appendConversationEditProposal, appendConversationMessage, applyConversationEditProposal,
  createConversation, deleteConversation, getConversation, undoConversationEditProposal,
  updateConversationCodexModel,
} from "./conversationHistory";
import { createChatModeProposalToolServices } from "./editProposalAutoApply";
import { createDirectoryProposalForWorkspace, createFileProposalForWorkspace } from "../edit-proposals/editProposalService";
import { withConversationFileLock } from "./conversationStorage";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "conversation-persistence-"));
  roots.push(root);
  const options = { dataRoot: path.join(root, "data"), workspaceRoot: root };
  const conversation = await createConversation(options);
  const file = path.join(options.dataRoot, "conversations", conversation.workspaceId, `${conversation.id}.json`);
  return { ...options, conversationId: conversation.id, file };
}
async function editFixture() {
  const options = await fixture();
  await writeFile(path.join(options.workspaceRoot, "story.txt"), "cat");
  const conversation = await appendConversationEditProposal({ ...options, path: "story.txt", oldText: "cat", newText: "cat!" });
  return { ...options, proposalId: conversation.editProposals[0].id, dirtyPaths: [] };
}

describe("conversation persistence with real files", () => {
  it("retains simultaneous messages and metadata updates", async () => {
    const options = await fixture();
    await Promise.all([
      ...Array.from({ length: 12 }, (_, i) => appendConversationMessage({ ...options, role: "user", content: String(i) })),
      updateConversationCodexModel({ ...options, selectedCodexModel: "test-model" }),
    ]);
    const conversation = await getConversation(options);
    expect(conversation.messages.map((message) => message.content).sort()).toEqual(Array.from({ length: 12 }, (_, i) => String(i)).sort());
    expect(conversation.selectedCodexModel).toBe("test-model");
  });

  it("does not resurrect a deleted conversation on a late update", async () => {
    const options = await fixture();
    await deleteConversation(options);
    await expect(appendConversationMessage({ ...options, content: "late", role: "assistant" })).rejects.toThrow();
    await expect(readFile(options.file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the old JSON when replacement fails and cleans the temporary file", async () => {
    const options = await fixture();
    const oldJson = await readFile(options.file, "utf8");
    vi.spyOn(fs, "rename").mockRejectedValueOnce(Object.assign(new Error("replacement denied"), { code: "EPERM" }));
    await expect(appendConversationMessage({ ...options, role: "user", content: "new" })).rejects.toThrow("replacement denied");
    expect(await readFile(options.file, "utf8")).toBe(oldJson);
    expect(await readdir(path.dirname(options.file))).toEqual([path.basename(options.file)]);
  });

  it.each(["apply", "undo"] as const)("recovers %s after history replacement failure without repeating the manuscript change", async (action) => {
    const options = await editFixture();
    if (action === "undo") await applyConversationEditProposal(options);
    const rename = fs.rename;
    let writes = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      if (String(args[1]) === options.file && ++writes === 2) throw new Error("history failed after manuscript");
      return rename(...args);
    });
    await expect(action === "apply" ? applyConversationEditProposal(options) : undoConversationEditProposal(options)).rejects.toThrow("history failed");
    vi.restoreAllMocks();
    const recovered = await getConversation(options);
    expect(recovered.editProposals[0].status).toBe(action === "apply" ? "applied" : "undone");
    expect(recovered.editProposals[0].undoSnapshot).toEqual({ beforeContent: "cat", afterContent: "cat!" });
    await (action === "apply" ? applyConversationEditProposal(options) : undoConversationEditProposal(options));
    expect(await readFile(path.join(options.workspaceRoot, "story.txt"), "utf8")).toBe(action === "apply" ? "cat!" : "cat");
  });

  it.each(["apply", "undo"] as const)("refuses external changes during %s recovery and keeps snapshots", async (action) => {
    const options = await editFixture();
    if (action === "undo") await applyConversationEditProposal(options);
    const rename = fs.rename;
    let writes = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      if (String(args[1]) === options.file && ++writes === 2) throw new Error("history failure");
      return rename(...args);
    });
    await expect(action === "apply" ? applyConversationEditProposal(options) : undoConversationEditProposal(options)).rejects.toThrow();
    vi.restoreAllMocks();
    const manuscript = path.join(options.workspaceRoot, "story.txt");
    await writeFile(manuscript, "external revision");
    const recovered = await getConversation(options);
    expect(recovered.editProposals[0]).toMatchObject({ status: "conflicted", undoSnapshot: { beforeContent: "cat", afterContent: "cat!" } });
    await applyConversationEditProposal(options);
    await expect(undoConversationEditProposal(options)).rejects.toThrow();
    expect(await readFile(manuscript, "utf8")).toBe("external revision");
  });

  it("keeps the previous JSON after a partial temporary-file write", async () => {
    const options = await fixture();
    const oldJson = await readFile(options.file, "utf8");
    const open = fs.open;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      const write = handle.writeFile.bind(handle);
      vi.spyOn(handle, "writeFile").mockImplementation(async () => {
        await write("{partial");
        throw new Error("disk full");
      });
      return handle;
    });
    await expect(appendConversationMessage({ ...options, role: "user", content: "new" })).rejects.toThrow("disk full");
    expect(await readFile(options.file, "utf8")).toBe(oldJson);
    expect(await readdir(path.dirname(options.file))).toEqual([path.basename(options.file)]);
  });

  it("does not change the manuscript if the recovery checkpoint cannot be saved", async () => {
    const options = await editFixture();
    vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("checkpoint failed"));
    await expect(applyConversationEditProposal(options)).rejects.toThrow("checkpoint failed");
    expect(await readFile(path.join(options.workspaceRoot, "story.txt"), "utf8")).toBe("cat");
    expect((await getConversation(options)).editProposals[0].status).toBe("pending");
  });

  it.each(["create", "createDirectory"] as const)("handles interrupted %s without overwriting a target", async (operation) => {
    const options = await fixture();
    const proposal = operation === "create"
      ? await createFileProposalForWorkspace({ workspaceRoot: options.workspaceRoot, path: "new", content: "created" })
      : await createDirectoryProposalForWorkspace({ workspaceRoot: options.workspaceRoot, path: "new" });
    await appendConversationEditProposal({ ...options, ...proposal, proposalId: proposal.id });
    const applyOptions = { ...options, proposalId: proposal.id, dirtyPaths: [] };
    const rename = fs.rename;
    let writes = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
      if (String(args[1]) === options.file && ++writes === 2) throw new Error("history failure");
      return rename(...args);
    });
    await expect(applyConversationEditProposal(applyOptions)).rejects.toThrow();
    vi.restoreAllMocks();
    const recovered = await getConversation(options);
    expect(recovered.editProposals[0].status).toBe(operation === "create" ? "applied" : "conflicted");
    await applyConversationEditProposal(applyOptions);
    if (operation === "create") {
      // Creation Undo also survives a lost history commit.
      writes = 0;
      vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
        if (String(args[1]) === options.file && ++writes === 2) throw new Error("undo history failure");
        return rename(...args);
      });
      await expect(undoConversationEditProposal(applyOptions)).rejects.toThrow();
      vi.restoreAllMocks();
      expect((await getConversation(options)).editProposals[0].status).toBe("undone");
      await undoConversationEditProposal(applyOptions);
      await expect(readFile(path.join(options.workspaceRoot, "new"))).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect(await readdir(path.join(options.workspaceRoot, "new"))).toEqual([]);
    }
  });

  it("saves a tool proposal before auto Apply, even when the agent never returns a result", async () => {
    const options = await fixture();
    const services = createChatModeProposalToolServices(options);
    const proposal = await services.createFileProposal!({ workspaceRoot: options.workspaceRoot, path: "automatic.txt", content: "saved" });
    const reloaded = await getConversation(options);
    expect(reloaded.editProposals).toHaveLength(1);
    expect(reloaded.editProposals[0]).toMatchObject({ id: proposal.id, status: "applied", undoSnapshot: { beforeContent: "", afterContent: "saved" } });
  });

  it("does not resurrect a conversation when deletion races a queued update", async () => {
    const options = await fixture();
    let unlock!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    const held = withConversationFileLock(await fs.realpath(options.file), async () => { entered(); await gate; });
    await ready;
    const results = Promise.allSettled([
      appendConversationMessage({ ...options, role: "user", content: "queued" }),
      deleteConversation(options),
    ]);
    unlock();
    await held;
    const settled = await results;
    expect(settled[1].status).toBe("fulfilled");
    await expect(readFile(options.file)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes separate Bun processes that share a history directory", async () => {
    const options = await fixture();
    const modulePath = path.resolve("src/features/ai-chat/conversationHistory.ts");
    const run = promisify(execFile);
    await Promise.all([0, 1].map((worker) => run("bun", ["-e", `
      import { appendConversationMessage } from ${JSON.stringify(modulePath)};
      await Promise.all(Array.from({length: 5}, (_, i) => appendConversationMessage({
        ...${JSON.stringify(options)}, role: "user", content: "${worker}:" + i
      })));
    `])));
    const conversation = await getConversation(options);
    expect(new Set(conversation.messages.map((message) => message.content)).size).toBe(10);
  });

  it("recovers after an actual process exit once the documented stale lock is removed", async () => {
    const options = await editFixture();
    const modulePath = path.resolve("src/features/ai-chat/conversationHistory.ts");
    await expect(promisify(execFile)("bun", ["-e", `
      import fs from "node:fs/promises";
      import { applyConversationEditProposal } from ${JSON.stringify(modulePath)};
      const rename = fs.rename;
      let writes = 0;
      fs.rename = async (...args) => {
        if (String(args[1]) === ${JSON.stringify(options.file)} && ++writes === 2) process.exit(71);
        return rename(...args);
      };
      await applyConversationEditProposal(${JSON.stringify(options)});
    `])).rejects.toMatchObject({ code: 71 });
    expect(await readFile(path.join(options.workspaceRoot, "story.txt"), "utf8")).toBe("cat!");
    // A crashed process cannot release its lock. Never steal it from a live writer.
    await expect(getConversation(options)).rejects.toThrow("storage is busy or was interrupted");
    await fs.rmdir(`${options.file}.lock`);
    const recovered = await getConversation(options);
    expect(recovered.editProposals[0].status).toBe("applied");
    expect(await readdir(path.dirname(options.file))).toEqual([path.basename(options.file)]);
    await applyConversationEditProposal(options);
    expect(await readFile(path.join(options.workspaceRoot, "story.txt"), "utf8")).toBe("cat!");
  });

});
