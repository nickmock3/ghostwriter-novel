import { describe, expect, it } from "vitest";
import {
  activateSkill,
  agentSkillMetadataSchema,
  builtInAgentSkills,
  createAgentSkillRegistry,
  getAgentSkill,
  listAgentSkillMetadata,
} from "./agentSkills";

describe("agent skills", () => {
  it("exposes built-in skill metadata without full instructions", () => {
    expect(builtInAgentSkills.length).toBeGreaterThan(0);

    const metadata = listAgentSkillMetadata();

    expect(metadata[0]).toEqual(
      expect.objectContaining({
        description: expect.any(String),
        displayName: expect.any(String),
        id: expect.any(String),
      }),
    );
    expect(metadata[0]).not.toHaveProperty("instruction");
    expect(() => agentSkillMetadataSchema.parse(metadata[0])).not.toThrow();
  });

  it("resolves only known built-in skills", () => {
    const firstSkill = builtInAgentSkills[0];

    expect(getAgentSkill(firstSkill.id)).toBe(firstSkill);
    expect(getAgentSkill("missing-skill")).toBeNull();
  });

  it("merges built-in and plugin skill metadata without exposing instructions", () => {
    const registry = createAgentSkillRegistry({
      plugins: [
        {
          createSkills: (context) => [
            {
              id: "project-review",
              displayName: "Project review",
              description: `Review within ${context.workspaceRoot}`,
              instruction: "Use project-specific review conventions.",
              requiredTools: ["Read"],
              triggerHints: ["review"],
            },
          ],
          displayName: "Project skills",
          id: "project",
          kind: "agent-skill",
        },
      ],
      workspaceRoot: "/tmp/workspace",
    });

    expect(registry.listMetadata()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: builtInAgentSkills[0].id }),
        expect.objectContaining({
          description: "Review within /tmp/workspace",
          displayName: "Project review",
          id: "project-review",
          triggerHints: ["review"],
        }),
      ]),
    );
    expect(JSON.stringify(registry.listMetadata())).not.toContain(
      "Use project-specific review conventions.",
    );
    expect(registry.getSkill("project-review")).toEqual(
      expect.objectContaining({
        id: "project-review",
        instruction: "Use project-specific review conventions.",
      }),
    );
  });

  it("rejects plugin skills that collide with built-in or plugin skill IDs", () => {
    expect(() =>
      createAgentSkillRegistry({
        plugins: [
          {
            createSkills: () => [
              {
                id: builtInAgentSkills[0].id,
                displayName: "Collision",
                description: "Collides with a built-in skill.",
                instruction: "Do not allow this.",
              },
            ],
            displayName: "Collision plugin",
            id: "collision",
            kind: "agent-skill",
          },
        ],
        workspaceRoot: "/tmp/workspace",
      }),
    ).toThrow(/collides with built-in skill/);

    expect(() =>
      createAgentSkillRegistry({
        plugins: [
          {
            createSkills: () => [
              {
                id: "shared-skill",
                displayName: "First",
                description: "First plugin skill.",
                instruction: "First instruction.",
              },
            ],
            displayName: "First plugin",
            id: "first",
            kind: "agent-skill",
          },
          {
            createSkills: () => [
              {
                id: "shared-skill",
                displayName: "Second",
                description: "Second plugin skill.",
                instruction: "Second instruction.",
              },
            ],
            displayName: "Second plugin",
            id: "second",
            kind: "agent-skill",
          },
        ],
        workspaceRoot: "/tmp/workspace",
      }),
    ).toThrow(/duplicate skill/);
  });

  it("activateSkill marks a known skill as active for the current run", () => {
    const registry = createAgentSkillRegistry({ workspaceRoot: "/tmp/workspace" });
    const activeSkillIds = new Set<string>();
    const firstSkill = builtInAgentSkills[0];

    expect(activateSkill({ activeSkillIds, skillId: firstSkill.id, skillRegistry: registry })).toEqual({
      displayName: firstSkill.displayName,
      skillId: firstSkill.id,
      status: "activated",
    });
    expect([...activeSkillIds]).toEqual([firstSkill.id]);
  });

  it("activateSkill rejects unknown skill ids", () => {
    const registry = createAgentSkillRegistry({ workspaceRoot: "/tmp/workspace" });

    expect(() =>
      activateSkill({
        activeSkillIds: new Set(),
        skillId: "missing-skill",
        skillRegistry: registry,
      }),
    ).toThrow(/Unknown skill: missing-skill/);
  });
});
