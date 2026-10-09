import { z } from "zod";
import {
  supportsOpenAICompatibleProfileTools,
  type AvailableLlmProvider,
  type LlmProviderId,
} from "../modelProvider";
import { resolveContextWindowTokens } from "./contextWindow";

export const llmProfileRoles = ["main", "writing", "simple", "search"] as const;
export type LlmProfileRole = (typeof llmProfileRoles)[number];

export type LlmProfile = {
  baseURL?: string;
  contextWindowTokensOverride?: number;
  id: string;
  maxOutputTokens: number;
  modelId: string;
  name: string;
  providerId: LlmProviderId;
  source: "built-in" | "user";
  supportsToolsOverride?: boolean;
  temperature: number;
};

export type ResolvedLlmProfile = LlmProfile & {
  available: boolean;
  contextWindowTokens: number;
  llmProfileRole: LlmProfileRole;
  supportsTemperature?: boolean;
  unavailableReason?: string;
};

export type LlmRoleAssignment =
  | {
      kind: "profile";
      profileId: string;
    }
  | {
      baseURL?: string;
      kind: "model";
      maxOutputTokens?: number;
      modelId: string;
      providerId: LlmProviderId;
      supportsToolsOverride?: boolean;
      temperature?: number;
    };

export type LlmProfileRoleAssignments = Record<LlmProfileRole, LlmRoleAssignment>;
export type LlmProfileRoleAssignment = LlmRoleAssignment;

const providerOrder = [
  "deepseek",
  "openai",
  "gemini",
  "anthropic",
  "openai-compatible",
] as const satisfies LlmProviderId[];
const llmProviderIdSchema = z.enum([
  "openai-chatgpt",
  "anthropic",
  "deepseek",
  "gemini",
  "openai",
  "openai-compatible",
]);

const llmRoleAssignmentProfileSchema = z.object({
  kind: z.literal("profile"),
  profileId: z.string().min(1),
});

const llmRoleAssignmentModelSchema = z.object({
  baseURL: z.string().optional(),
  kind: z.literal("model"),
  maxOutputTokens: z.number().int().positive().max(128000).optional(),
  modelId: z.string().min(1),
  providerId: llmProviderIdSchema,
  supportsToolsOverride: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
}).superRefine(validateProviderConnectionSettings);

const legacyLlmRoleAssignmentSchema = z.string().min(1).transform((profileId) => ({
  kind: "profile" as const,
  profileId,
}));

export const llmRoleAssignmentSchema = z.union([
  llmRoleAssignmentProfileSchema,
  llmRoleAssignmentModelSchema,
  legacyLlmRoleAssignmentSchema,
]);

const baseLlmProfileSchema = z.object({
  baseURL: z.string().optional(),
  contextWindowTokensOverride: z.number().int().positive().max(100_000_000).optional(),
  id: z.string().min(1),
  maxOutputTokens: z.number().int().positive().max(128000),
  modelId: z.string().min(1),
  name: z.string().min(1),
  providerId: llmProviderIdSchema,
  source: z.enum(["built-in", "user"]),
  supportsToolsOverride: z.boolean().optional(),
  temperature: z.number().min(0).max(2),
});

export const llmProfileSchema = baseLlmProfileSchema.superRefine(validateProviderConnectionSettings);

export const persistedLlmProfilesSchema = z.array(
  baseLlmProfileSchema.extend({
    source: z.literal("user"),
  }).superRefine(validateProviderConnectionSettings),
);

export const llmProfileRoleAssignmentsSchema = z.object({
  main: llmRoleAssignmentSchema,
  search: llmRoleAssignmentSchema,
  simple: llmRoleAssignmentSchema,
  writing: llmRoleAssignmentSchema,
});

export function getDefaultMaxOutputTokens(role: LlmProfileRole): number {
  if (role === "writing") {
    return 65536;
  }
  return role === "simple" || role === "search" ? 2048 : 4096;
}

function builtInProfile(
  providerId: LlmProviderId,
  role: LlmProfileRole,
  modelId: string,
  name: string,
): LlmProfile {
  return {
    id: `builtin:${providerId}:${role}`,
    maxOutputTokens: getDefaultMaxOutputTokens(role),
    modelId,
    name,
    providerId,
    source: "built-in",
    temperature: role === "writing" ? 0.7 : 0.3,
  };
}

export const builtInLlmProfiles: LlmProfile[] = [
  builtInProfile("deepseek", "main", "deepseek-v4-pro", "DeepSeek 通常"),
  builtInProfile("deepseek", "writing", "deepseek-v4-pro", "DeepSeek 執筆"),
  builtInProfile("deepseek", "simple", "deepseek-flash", "DeepSeek 軽作業"),
  builtInProfile("deepseek", "search", "deepseek-flash", "DeepSeek 検索"),
  builtInProfile("openai", "main", "gpt-6-sol", "OpenAI 通常"),
  builtInProfile("openai", "writing", "gpt-6-astra", "OpenAI 執筆"),
  builtInProfile("openai", "simple", "gpt-6-luna", "OpenAI 軽作業"),
  builtInProfile("openai", "search", "gpt-6-luna", "OpenAI 検索"),
  builtInProfile("gemini", "main", "gemini-3.8-flash", "Gemini 通常"),
  builtInProfile("gemini", "writing", "gemini-3.8-flash", "Gemini 執筆"),
  builtInProfile("gemini", "simple", "gemini-3.5-flash-lite", "Gemini 軽作業"),
  builtInProfile("gemini", "search", "gemini-3.5-flash-lite", "Gemini 検索"),
  builtInProfile("anthropic", "main", "claude-opus-5-5", "Anthropic 通常"),
  builtInProfile("anthropic", "writing", "claude-fable-5-1", "Anthropic 執筆"),
  builtInProfile("anthropic", "simple", "claude-haiku-4-5-20251001", "Anthropic 軽作業"),
  builtInProfile("anthropic", "search", "claude-haiku-4-5-20251001", "Anthropic 検索"),
];

export function getLlmProfileTemperature(
  profile: Pick<ResolvedLlmProfile, "supportsTemperature" | "temperature">,
  override?: number,
): number | undefined {
  if (profile.supportsTemperature === false) {
    return undefined;
  }
  return override ?? profile.temperature;
}

export function writingProfileResolutionError(profile: ResolvedLlmProfile): string | null {
  if (!profile.available) {
    return profile.unavailableReason ?? 'No available LLM profile for role "writing"';
  }
  if (profile.llmProfileRole !== "writing") {
    return `Expected writing LLM profile role but received "${profile.llmProfileRole}"`;
  }
  return null;
}

function findProvider(providers: AvailableLlmProvider[], providerId: LlmProviderId) {
  return providers.find((provider) => provider.id === providerId);
}

function profileAssignment(profileId: string): LlmRoleAssignment {
  return { kind: "profile", profileId };
}

function modelAssignment(
  providerId: LlmProviderId,
  modelId: string,
  options: {
    baseURL?: string;
    maxOutputTokens?: number;
    supportsToolsOverride?: boolean;
    temperature?: number;
  } = {},
): LlmRoleAssignment {
  return {
    kind: "model",
    modelId,
    providerId,
    ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    ...(options.supportsToolsOverride !== undefined
      ? { supportsToolsOverride: options.supportsToolsOverride }
      : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
  };
}

function availabilityForProfile(profile: LlmProfile, providers: AvailableLlmProvider[]) {
  const provider = findProvider(providers, profile.providerId);
  if (!provider) {
    return { available: false, unavailableReason: "providerが利用できません。" };
  }
  if (profile.source === "user" && profile.providerId === "openai-compatible") {
    if (!supportsOpenAICompatibleProfileTools(profile)) {
      return {
        available: false,
        unavailableReason: "このプロフィールはツール実行に対応していません。",
      };
    }
    return { available: true, unavailableReason: undefined };
  }
  const model = provider.models.find((candidate) => candidate.id === profile.modelId);
  if (!model) {
    return { available: false, unavailableReason: "モデルが許可されていません。" };
  }
  if (!model.available) {
    return {
      available: false,
      unavailableReason: model.unavailableReason ?? "このプロフィールは利用できません。",
    };
  }
  return { available: true, unavailableReason: undefined };
}

export function listLlmProfiles(options: {
  providers: AvailableLlmProvider[];
  userProfiles?: LlmProfile[];
}): Array<LlmProfile & { available: boolean; unavailableReason?: string }> {
  return [...builtInLlmProfiles, ...(options.userProfiles ?? [])].map((profile) => ({
    ...profile,
    ...availabilityForProfile(profile, options.providers),
  }));
}

function builtInProfileId(providerId: LlmProviderId, role: LlmProfileRole) {
  return `builtin:${providerId}:${role}`;
}

function providerHasAvailableRole(
  providers: AvailableLlmProvider[],
  providerId: LlmProviderId,
  role: LlmProfileRole,
) {
  const profile = builtInLlmProfiles.find((candidate) => candidate.id === builtInProfileId(providerId, role));
  return profile ? availabilityForProfile(profile, providers).available : false;
}

function firstAvailableProvider(
  providers: AvailableLlmProvider[],
  defaultProviderId?: string,
): LlmProviderId | null {
  const preferred = providerOrder.filter((providerId) => providerId === defaultProviderId);
  const candidates = [...preferred, ...providerOrder.filter((providerId) => providerId !== defaultProviderId)];
  return candidates.find((providerId) => llmProfileRoles.every((role) => providerHasAvailableRole(providers, providerId, role))) ?? null;
}

export function createDefaultRoleAssignments(options: {
  defaultProviderId?: string;
  providers: AvailableLlmProvider[];
}): LlmProfileRoleAssignments {
  if (options.defaultProviderId === "openai-chatgpt") {
    const model = options.providers.find(provider => provider.id === "openai-chatgpt")?.models.find(model => model.available);
    if (!model) throw new Error("ChatGPTで利用できるモデルがありません。");
    return { main: modelAssignment("openai-chatgpt", model.id), search: modelAssignment("openai-chatgpt", model.id), simple: modelAssignment("openai-chatgpt", model.id), writing: modelAssignment("openai-chatgpt", model.id) };
  }
  const providerId = firstAvailableProvider(options.providers, options.defaultProviderId) ?? "deepseek";
  return {
    main: profileAssignment(builtInProfileId(providerId, "main")),
    search: profileAssignment(builtInProfileId(providerId, "search")),
    simple: profileAssignment(builtInProfileId(providerId, "simple")),
    writing: profileAssignment(builtInProfileId(providerId, "writing")),
  };
}

function roleAssignmentProfile(profile: LlmProfile, role: LlmProfileRole): boolean {
  return profile.source === "user" || profile.id.endsWith(`:${role}`);
}

function profileDisplayName(provider: AvailableLlmProvider, modelId: string) {
  const model = provider.models.find((candidate) => candidate.id === modelId);
  return model ? `${provider.displayName} / ${model.displayName}` : provider.displayName;
}

function normalizeRoleAssignment(options: {
  assignment: LlmRoleAssignment;
  defaultAssignment: LlmRoleAssignment;
  providers: AvailableLlmProvider[];
  profiles: Array<LlmProfile & { available: boolean; unavailableReason?: string }>;
  role: LlmProfileRole;
}): LlmRoleAssignment {
  const { assignment, defaultAssignment, profiles, providers, role } = options;

  if (assignment.kind === "profile") {
    const profile = profiles.find((candidate) => candidate.id === assignment.profileId);
    if (profile?.providerId === "openai-chatgpt") return profileAssignment(profile.id);
    if (profile?.available && roleAssignmentProfile(profile, role)) {
      return profileAssignment(profile.id);
    }
    return defaultAssignment;
  }

  if (assignment.providerId === "openai-chatgpt") return assignment;
  const provider = findProvider(providers, assignment.providerId);
  if (!provider) {
    return defaultAssignment;
  }

  const model = provider.models.find((candidate) => candidate.id === assignment.modelId);
  if (!model?.available) {
    return defaultAssignment;
  }

  return modelAssignment(provider.id, model.id, {
    ...(assignment.baseURL !== undefined ? { baseURL: assignment.baseURL } : {}),
    ...(assignment.temperature !== undefined ? { temperature: assignment.temperature } : {}),
    ...(assignment.maxOutputTokens !== undefined ? { maxOutputTokens: assignment.maxOutputTokens } : {}),
    ...(assignment.supportsToolsOverride !== undefined
      ? { supportsToolsOverride: assignment.supportsToolsOverride }
      : {}),
  });
}

export function normalizeRoleAssignments(options: {
  assignments: unknown;
  defaultProviderId?: string;
  providers: AvailableLlmProvider[];
  userProfiles?: LlmProfile[];
}): LlmProfileRoleAssignments {
  const defaults = createDefaultRoleAssignments(options);
  const parsed = llmProfileRoleAssignmentsSchema.safeParse(options.assignments);
  const assignments = parsed.success ? parsed.data : defaults;
  const profiles = listLlmProfiles({ providers: options.providers, userProfiles: options.userProfiles });

  return Object.fromEntries(
    llmProfileRoles.map((role) => {
      return [
        role,
        normalizeRoleAssignment({
          assignment: assignments[role],
          defaultAssignment: defaults[role],
          providers: options.providers,
          profiles,
          role,
        }),
      ];
    }),
  ) as LlmProfileRoleAssignments;
}

function resolveProfileContextWindowTokens(
  profile: Pick<LlmProfile, "contextWindowTokensOverride" | "modelId" | "providerId">,
  providers: AvailableLlmProvider[],
): number {
  const provider = findProvider(providers, profile.providerId);
  const model = provider?.models.find((candidate) => candidate.id === profile.modelId);
  return resolveContextWindowTokens({
    contextWindowTokens: model?.contextWindowTokens,
    contextWindowTokensOverride: profile.contextWindowTokensOverride,
  });
}

function resolveProfileSupportsTemperature(
  profile: Pick<LlmProfile, "modelId" | "providerId">,
  providers: AvailableLlmProvider[],
): boolean | undefined {
  const provider = findProvider(providers, profile.providerId);
  const model = provider?.models.find((candidate) => candidate.id === profile.modelId);
  return model?.supportsTemperature;
}

export function resolveLlmProfileForRole(options: {
  assignments: unknown;
  defaultProviderId?: string;
  providers: AvailableLlmProvider[];
  role?: LlmProfileRole;
  userProfiles?: LlmProfile[];
}): ResolvedLlmProfile {
  const role = options.role ?? "main";
  const assignments = normalizeRoleAssignments(options);
  const profiles = listLlmProfiles({ providers: options.providers, userProfiles: options.userProfiles });
  const assignment = assignments[role];

  if (assignment.kind === "profile") {
    const profile = profiles.find((candidate) => candidate.id === assignment.profileId);
    if (!profile?.available) {
      throw new Error(`No available LLM profile for role "${role}"`);
    }
    return {
      ...profile,
      available: true,
      contextWindowTokens: resolveProfileContextWindowTokens(profile, options.providers),
      llmProfileRole: role,
      ...(resolveProfileSupportsTemperature(profile, options.providers) === false
        ? { supportsTemperature: false }
        : {}),
    };
  }

  const provider = findProvider(options.providers, assignment.providerId);
  if (!provider) {
    throw new Error(`No available LLM profile for role "${role}"`);
  }
  const model = provider.models.find((candidate) => candidate.id === assignment.modelId);
  if (!model?.available) {
    throw new Error(`No available LLM profile for role "${role}"`);
  }
  return {
    available: true,
    contextWindowTokens: resolveContextWindowTokens({
      contextWindowTokens: model.contextWindowTokens,
    }),
    id: `model:${provider.id}:${model.id}`,
    llmProfileRole: role,
    maxOutputTokens: assignment.maxOutputTokens ?? getDefaultMaxOutputTokens(role),
    modelId: model.id,
    name: profileDisplayName(provider, model.id),
    providerId: provider.id,
    source: "user",
    ...(assignment.baseURL !== undefined ? { baseURL: assignment.baseURL } : {}),
    ...(assignment.supportsToolsOverride !== undefined
      ? { supportsToolsOverride: assignment.supportsToolsOverride }
      : {}),
    ...(model.supportsTemperature === false ? { supportsTemperature: false } : {}),
    temperature: assignment.temperature ?? (role === "writing" ? 0.7 : 0.3),
  };
}

export function parsePersistedLlmProfiles(value: unknown): LlmProfile[] {
  const parsed = persistedLlmProfilesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parsePersistedRoleAssignments(value: unknown): Partial<LlmProfileRoleAssignments> {
  const parsed = llmProfileRoleAssignmentsSchema.partial().safeParse(value);
  return parsed.success ? parsed.data : {};
}

function validateProviderConnectionSettings(
  value: { baseURL?: string; providerId: LlmProviderId },
  context: z.RefinementCtx,
) {
  if (value.providerId === "openai-chatgpt" && value.baseURL !== undefined) {
    context.addIssue({ code: "custom", message: "ChatGPT接続のURLは変更できません。", path: ["baseURL"] });
    return;
  }
  if (value.providerId === "openai-compatible" && !value.baseURL) {
    context.addIssue({
      code: "custom",
      message: "OpenAI互換providerではbase URLが必須です。",
      path: ["baseURL"],
    });
    return;
  }

  if (value.baseURL === undefined) {
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.baseURL);
  } catch {
    context.addIssue({
      code: "custom",
      message: "base URLは有効なURLである必要があります。",
      path: ["baseURL"],
    });
    return;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      message: "base URLはhttpまたはhttpsである必要があります。",
      path: ["baseURL"],
    });
  }

  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    context.addIssue({
      code: "custom",
      message: "base URLに認証情報、クエリ、フラグメントを含めることはできません。",
      path: ["baseURL"],
    });
  }
}
