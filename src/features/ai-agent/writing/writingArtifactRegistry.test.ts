import { describe, expect, it, vi } from "vitest";
import {
  createProposalFromArtifact,
  createWritingArtifactRegistry,
  toPublicDelegateWritingOutput,
  type WritingArtifactRegistry,
} from "./writingArtifactRegistry";

const tokenUsage = {
  llmProfileId: "test:writing",
  llmProfileRole: "writing" as const,
  modelId: "writing-model",
  providerId: "deepseek",
};

function createRegistryWithArtifact(
  artifactId: string,
  entry: WritingArtifactRegistry["artifacts"] extends Map<string, infer T> ? T : never,
): WritingArtifactRegistry {
  return {
    artifacts: new Map([[artifactId, entry]]),
    consumedArtifactIds: new Set<string>(),
    delegateWritingFailedPaths: new Set<string>(),
  };
}

describe("writingArtifactRegistry", () => {
  it("keeps manuscript text in the run-scoped registry and out of the public result", () => {
    const registry = createWritingArtifactRegistry();

    const output = toPublicDelegateWritingOutput(registry, {
      artifact: {
        newText: "NEW_MANUSCRIPT_TEXT",
        oldText: "OLD_MANUSCRIPT_TEXT",
      },
      latencyMs: 12,
      operation: "edit",
      status: "completed",
      targetPath: "manuscript\\chapter-01.txt",
      tokenUsage,
    });

    expect(output).toMatchObject({
      artifactId: expect.any(String),
      operation: "edit",
      status: "completed",
      targetPath: "manuscript/chapter-01.txt",
    });
    expect(JSON.stringify(output)).not.toContain("MANUSCRIPT_TEXT");

    if (output.status !== "completed") {
      throw new Error("Expected completed writing delegation output");
    }
    expect(registry.artifacts.get(output.artifactId)).toMatchObject({
      newText: "NEW_MANUSCRIPT_TEXT",
      oldText: "OLD_MANUSCRIPT_TEXT",
      targetPath: "manuscript/chapter-01.txt",
    });
  });

  it("records normalized failed targets so generic Edit/Create fallback stays blocked", () => {
    const registry = createWritingArtifactRegistry();

    expect(
      toPublicDelegateWritingOutput(registry, {
        message: "writing failed",
        status: "error",
        targetPath: "manuscript\\chapter-01.txt",
      }),
    ).toEqual({
      message: "writing failed",
      status: "error",
      targetPath: "manuscript\\chapter-01.txt",
    });
    expect(registry.delegateWritingFailedPaths).toEqual(
      new Set(["manuscript/chapter-01.txt"]),
    );
  });

  it("createProposalFromArtifact consumes an edit artifact and stamps sourceRole writing", async () => {
    const registry = createRegistryWithArtifact("artifact-edit", {
      latencyMs: 1,
      newText: "new prose",
      oldText: "old prose",
      operation: "edit",
      targetPath: "manuscript/chapter-01.txt",
      tokenUsage,
    });
    const createEditProposal = vi.fn(async (input) => ({
      createdAt: "2026-06-20T00:00:00.000Z",
      diff: "diff",
      id: "proposal-edit",
      newText: input.newText,
      oldText: input.oldText,
      operation: "edit" as const,
      path: input.path,
      status: "pending" as const,
      title: "Edit",
      updatedAt: "2026-06-20T00:00:00.000Z",
    }));
    const createFileProposal = vi.fn();

    const proposal = await createProposalFromArtifact({
      artifactId: "artifact-edit",
      createEditProposal,
      createFileProposal,
      registry,
      workspaceRoot: "/tmp/workspace",
    });

    expect(createEditProposal).toHaveBeenCalledWith({
      newText: "new prose",
      oldText: "old prose",
      path: "manuscript/chapter-01.txt",
      workspaceRoot: "/tmp/workspace",
    });
    expect(createFileProposal).not.toHaveBeenCalled();
    expect(proposal).toMatchObject({
      path: "manuscript/chapter-01.txt",
      sourceRole: "writing",
    });
    expect(registry.consumedArtifactIds.has("artifact-edit")).toBe(true);
  });

  it("createProposalFromArtifact routes create artifacts to createFileProposal", async () => {
    const generatedText = "new scene\n";
    const registry = createRegistryWithArtifact("artifact-create", {
      latencyMs: 2,
      newText: generatedText,
      oldText: "ignored",
      operation: "create",
      targetPath: "manuscript/scene-02.txt",
      tokenUsage,
    });
    const createEditProposal = vi.fn();
    const createFileProposal = vi.fn(async (input) => ({
      createdAt: "2026-06-22T00:00:00.000Z",
      diff: "diff",
      id: "proposal-create",
      newText: input.content,
      oldText: "",
      operation: "create" as const,
      path: input.path,
      status: "pending" as const,
      title: "Create",
      updatedAt: "2026-06-22T00:00:00.000Z",
    }));

    const proposal = await createProposalFromArtifact({
      artifactId: "artifact-create",
      createEditProposal,
      createFileProposal,
      registry,
      workspaceRoot: "/tmp/workspace",
    });

    expect(createFileProposal).toHaveBeenCalledWith({
      content: generatedText,
      path: "manuscript/scene-02.txt",
      workspaceRoot: "/tmp/workspace",
    });
    expect(createEditProposal).not.toHaveBeenCalled();
    expect(proposal).toMatchObject({
      operation: "create",
      sourceRole: "writing",
    });
    expect(registry.consumedArtifactIds.has("artifact-create")).toBe(true);
  });

  it("createProposalFromArtifact rolls back consumption when proposal creation fails", async () => {
    const registry = createRegistryWithArtifact("artifact-retry", {
      latencyMs: 1,
      newText: "new",
      oldText: "old",
      operation: "edit",
      targetPath: "chapter.txt",
      tokenUsage,
    });
    const createEditProposal = vi
      .fn()
      .mockRejectedValueOnce(new Error("proposal validation failed"));
    const createFileProposal = vi.fn();

    await expect(
      createProposalFromArtifact({
        artifactId: "artifact-retry",
        createEditProposal,
        createFileProposal,
        registry,
        workspaceRoot: "/tmp/workspace",
      }),
    ).rejects.toThrow("proposal validation failed");

    expect(registry.consumedArtifactIds.has("artifact-retry")).toBe(false);
  });

  it("createProposalFromArtifact rejects unknown and already consumed artifact ids", async () => {
    const registry = createRegistryWithArtifact("artifact-used", {
      latencyMs: 1,
      newText: "new",
      oldText: "old",
      operation: "edit",
      targetPath: "chapter.txt",
      tokenUsage,
    });
    registry.consumedArtifactIds.add("artifact-used");
    const createEditProposal = vi.fn();
    const createFileProposal = vi.fn();

    await expect(
      createProposalFromArtifact({
        artifactId: "missing",
        createEditProposal,
        createFileProposal,
        registry,
        workspaceRoot: "/tmp/workspace",
      }),
    ).rejects.toThrow(/unknown/i);

    await expect(
      createProposalFromArtifact({
        artifactId: "artifact-used",
        createEditProposal,
        createFileProposal,
        registry,
        workspaceRoot: "/tmp/workspace",
      }),
    ).rejects.toThrow(/consumed/i);

    expect(createEditProposal).not.toHaveBeenCalled();
    expect(createFileProposal).not.toHaveBeenCalled();
  });
});
