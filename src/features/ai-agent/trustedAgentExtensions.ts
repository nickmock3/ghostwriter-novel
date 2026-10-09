import { getAgentProfile } from "./agentProfiles";
import type { AgentSkillPlugin } from "./agentSkills";
import type { AgentToolPlugin } from "./tools/agentTools";

export type TrustedAgentExtensionCatalog = {
  profileToolGrants: Readonly<Record<string, readonly string[]>>;
  skillPlugins: readonly AgentSkillPlugin[];
  toolPlugins: readonly AgentToolPlugin[];
};

export type CreateTrustedAgentExtensionCatalogInput = {
  profileToolGrants: Readonly<Record<string, readonly string[]>>;
  skillPlugins: readonly AgentSkillPlugin[];
  toolPlugins: readonly AgentToolPlugin[];
};

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
}

function validatePlugin(
  plugin: AgentSkillPlugin | AgentToolPlugin,
  expectedKind: "agent-skill" | "agent-tool",
): void {
  if (!plugin || typeof plugin !== "object") {
    throw new Error("Agent plugin must be an object.");
  }
  assertNonEmptyString(plugin.id, "Agent plugin id");
  assertNonEmptyString(plugin.displayName, `Agent plugin "${plugin.id}" displayName`);
  const pluginId = plugin.id;

  if (plugin.kind !== expectedKind) {
    throw new Error(
      `Agent plugin "${pluginId}" in ${expectedKind} catalog has an invalid kind: ${plugin.kind}`,
    );
  }

  if (expectedKind === "agent-skill") {
    const skillPlugin = plugin as AgentSkillPlugin;
    if (typeof skillPlugin.createSkills !== "function") {
      throw new Error(`AgentSkillPlugin "${pluginId}" createSkills must be a function.`);
    }
    return;
  }

  const toolPlugin = plugin as AgentToolPlugin;
  if (typeof toolPlugin.createTools !== "function") {
    throw new Error(`AgentToolPlugin "${pluginId}" createTools must be a function.`);
  }
}

export function createTrustedAgentExtensionCatalog(
  input: CreateTrustedAgentExtensionCatalogInput,
): TrustedAgentExtensionCatalog {
  const pluginIds = new Set<string>();
  for (const plugin of input.skillPlugins) {
    validatePlugin(plugin, "agent-skill");
    if (pluginIds.has(plugin.id)) {
      throw new Error(`Duplicate plugin id: ${plugin.id}`);
    }
    pluginIds.add(plugin.id);
  }
  for (const plugin of input.toolPlugins) {
    validatePlugin(plugin, "agent-tool");
    if (pluginIds.has(plugin.id)) {
      throw new Error(`Duplicate plugin id: ${plugin.id}`);
    }
    pluginIds.add(plugin.id);
  }

  const profileToolGrants: Record<string, readonly string[]> = {};
  for (const [profileId, toolNames] of Object.entries(input.profileToolGrants)) {
    if (!getAgentProfile(profileId)) {
      throw new Error(`Unknown agent profile in tool grants: ${profileId}`);
    }

    const seenToolNames = new Set<string>();
    const validatedToolNames: string[] = [];
    for (const toolName of toolNames) {
      assertNonEmptyString(toolName, `Tool grant for agent profile "${profileId}"`);
      if (seenToolNames.has(toolName)) {
        throw new Error(`Duplicate tool grant "${toolName}" for agent profile "${profileId}".`);
      }
      seenToolNames.add(toolName);
      validatedToolNames.push(toolName);
    }
    profileToolGrants[profileId] = validatedToolNames;
  }

  return {
    profileToolGrants,
    skillPlugins: [...input.skillPlugins],
    toolPlugins: [...input.toolPlugins],
  };
}

export const emptyTrustedAgentExtensionCatalog: TrustedAgentExtensionCatalog =
  createTrustedAgentExtensionCatalog({
    profileToolGrants: {},
    skillPlugins: [],
    toolPlugins: [],
  });
