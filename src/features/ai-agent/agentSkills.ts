import { z } from "zod";

export const agentSkillSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  instruction: z.string().min(1),
  triggerHints: z.array(z.string().min(1)).optional(),
  requiredTools: z.array(z.string().min(1)).optional(),
});

export type AgentSkill = z.infer<typeof agentSkillSchema>;

export const agentSkillMetadataSchema = agentSkillSchema.omit({
  instruction: true,
  requiredTools: true,
});

export type AgentSkillMetadata = z.infer<typeof agentSkillMetadataSchema>;

export type AgentSkillPluginContext = {
  workspaceRoot: string;
};

export type AgentSkillPlugin = {
  createSkills: (context: AgentSkillPluginContext) => AgentSkill[];
  displayName: string;
  id: string;
  kind: "agent-skill";
};

export type AgentSkillRegistry = {
  getSkill: (skillId: string) => AgentSkill | null;
  listMetadata: () => AgentSkillMetadata[];
};

export type CreateAgentSkillRegistryOptions = {
  plugins?: AgentSkillPlugin[];
  workspaceRoot: string;
};

export const builtInAgentSkills = [
  {
    id: "focused-implementation",
    displayName: "Focused implementation",
    description:
      "Use for small implementation tasks where the agent should inspect context, make scoped changes, and verify behavior.",
    instruction: [
      "Focused implementation skill:",
      "Keep changes scoped to the requested task and existing ownership boundaries.",
      "Inspect the relevant code and tests before editing.",
      "Prefer minimal, test-backed changes over broad refactors.",
      "Do not expand tool permissions, bypass workspace validation, or apply edits without user approval.",
    ].join("\n"),
    triggerHints: ["implementation", "bug fix", "test-backed change"],
    requiredTools: ["Read", "Grep", "Search", "Edit"],
  },
] as const satisfies AgentSkill[];

const builtInAgentSkillsById = new Map<string, AgentSkill>(
  builtInAgentSkills.map((skill) => [skill.id, skill]),
);

function toAgentSkillMetadata(skill: AgentSkill): AgentSkillMetadata {
  return agentSkillMetadataSchema.parse({
    description: skill.description,
    displayName: skill.displayName,
    id: skill.id,
    triggerHints: skill.triggerHints,
  });
}

export function createAgentSkillRegistry(
  options: CreateAgentSkillRegistryOptions,
): AgentSkillRegistry {
  const skillsById = new Map<string, AgentSkill>();
  const builtInSkillIds = new Set<string>();

  for (const skill of builtInAgentSkills) {
    const parsedSkill = agentSkillSchema.parse(skill);
    skillsById.set(parsedSkill.id, parsedSkill);
    builtInSkillIds.add(parsedSkill.id);
  }

  for (const plugin of options.plugins ?? []) {
    const pluginSkills = plugin.createSkills({ workspaceRoot: options.workspaceRoot });
    for (const pluginSkill of pluginSkills) {
      const parsedSkill = agentSkillSchema.parse(pluginSkill);
      if (builtInSkillIds.has(parsedSkill.id)) {
        throw new Error(
          `AgentSkillPlugin "${plugin.id}" skill "${parsedSkill.id}" collides with built-in skill "${parsedSkill.id}".`,
        );
      }
      if (skillsById.has(parsedSkill.id)) {
        throw new Error(
          `AgentSkillPlugin "${plugin.id}" registered duplicate skill "${parsedSkill.id}".`,
        );
      }
      skillsById.set(parsedSkill.id, parsedSkill);
    }
  }

  return {
    getSkill: (skillId: string): AgentSkill | null => skillsById.get(skillId) ?? null,
    listMetadata: (): AgentSkillMetadata[] =>
      Array.from(skillsById.values(), (skill) => toAgentSkillMetadata(skill)),
  };
}

export function activateSkill(options: {
  activeSkillIds?: Set<string>;
  skillId: string;
  skillRegistry: AgentSkillRegistry;
}): {
  displayName: string;
  skillId: string;
  status: "activated";
} {
  const skill = options.skillRegistry.getSkill(options.skillId);
  if (!skill) {
    throw new Error(`Unknown skill: ${options.skillId}`);
  }

  options.activeSkillIds?.add(skill.id);
  return {
    displayName: skill.displayName,
    skillId: skill.id,
    status: "activated",
  };
}

export function listAgentSkillMetadata(): AgentSkillMetadata[] {
  return builtInAgentSkills.map((skill) => toAgentSkillMetadata(skill));
}

export function getAgentSkill(skillId: string): AgentSkill | null {
  return builtInAgentSkillsById.get(skillId) ?? null;
}
