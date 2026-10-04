import { describe, expect, it } from "vitest";
import {
  createTrustedAgentExtensionCatalog,
  emptyTrustedAgentExtensionCatalog,
} from "./trustedAgentExtensions";

describe("trusted agent extensions", () => {
  it("keeps skill plugins, tool plugins, and server profile grants separate", () => {
    const skillPlugin = {
      createSkills: () => [],
      displayName: "Project skills",
      id: "project-skills",
      kind: "agent-skill" as const,
    };
    const toolPlugin = {
      createTools: () => ({}),
      displayName: "Project tools",
      id: "project-tools",
      kind: "agent-tool" as const,
    };

    const catalog = createTrustedAgentExtensionCatalog({
      profileToolGrants: {
        "main-agent": ["ProjectLookup"],
      },
      skillPlugins: [skillPlugin],
      toolPlugins: [toolPlugin],
    });

    expect(catalog.skillPlugins).toEqual([skillPlugin]);
    expect(catalog.toolPlugins).toEqual([toolPlugin]);
    expect(catalog.profileToolGrants).toEqual({
      "main-agent": ["ProjectLookup"],
    });
    expect(emptyTrustedAgentExtensionCatalog).toEqual({
      profileToolGrants: {},
      skillPlugins: [],
      toolPlugins: [],
    });
  });

  it("rejects duplicate plugin IDs across skill and tool plugins", () => {
    expect(() =>
      createTrustedAgentExtensionCatalog({
        profileToolGrants: {},
        skillPlugins: [
          {
            createSkills: () => [],
            displayName: "Project skills",
            id: "project",
            kind: "agent-skill",
          },
        ],
        toolPlugins: [
          {
            createTools: () => ({}),
            displayName: "Project tools",
            id: "project",
            kind: "agent-tool",
          },
        ],
      }),
    ).toThrow(/duplicate plugin id.*project/i);
  });

  it("rejects invalid plugin definitions and profile grants", () => {
    expect(() =>
      createTrustedAgentExtensionCatalog({
        profileToolGrants: {},
        skillPlugins: [
          {
            createSkills: null,
            displayName: "Invalid",
            id: "invalid",
            kind: "agent-skill",
          } as never,
        ],
        toolPlugins: [],
      }),
    ).toThrow(/createSkills/);

    expect(() =>
      createTrustedAgentExtensionCatalog({
        profileToolGrants: { "missing-profile": ["ProjectLookup"] },
        skillPlugins: [],
        toolPlugins: [],
      }),
    ).toThrow(/unknown agent profile.*missing-profile/i);

    expect(() =>
      createTrustedAgentExtensionCatalog({
        profileToolGrants: { "main-agent": ["ProjectLookup", "ProjectLookup"] },
        skillPlugins: [],
        toolPlugins: [],
      }),
    ).toThrow(/duplicate tool grant.*ProjectLookup/i);
  });
});
