import { z } from "zod";
import {
  llmProfileRoleAssignmentsSchema,
  llmProfileSchema,
} from "../ai-agent/llmProfiles";
import { aiAssistStandardModelSelectionSchema } from "./aiAssistModelSelection";

export const AI_ASSIST_NAME_MAX_LENGTH = 80;
export const AI_ASSIST_DESCRIPTION_MAX_LENGTH = 500;
export const AI_ASSIST_FIXED_INSTRUCTION_MAX_LENGTH = 4000;
export const AI_ASSIST_ADDITIONAL_INSTRUCTION_PLACEHOLDER_MAX_LENGTH = 120;

export const aiAssistTargetTypeSchema = z.literal("text");
export const aiAssistResultTypeSchema = z.literal("edit-proposal");

function trimmedBoundedText(maxLength: number, options: { allowEmpty?: boolean } = {}) {
  return z
    .string()
    .transform((value) => value.trim())
    .superRefine((value, context) => {
      if (!options.allowEmpty && value.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Value is required",
        });
        return;
      }

      if (value.length > maxLength) {
        context.addIssue({
          code: "custom",
          message: `Value must be at most ${maxLength} characters`,
        });
      }
    });
}

const aiAssistNameSchema = trimmedBoundedText(AI_ASSIST_NAME_MAX_LENGTH);
const aiAssistDescriptionSchema = trimmedBoundedText(AI_ASSIST_DESCRIPTION_MAX_LENGTH, {
  allowEmpty: true,
});
const aiAssistFixedInstructionSchema = trimmedBoundedText(
  AI_ASSIST_FIXED_INSTRUCTION_MAX_LENGTH,
);
const aiAssistAdditionalInstructionPlaceholderSchema = trimmedBoundedText(
  AI_ASSIST_ADDITIONAL_INSTRUCTION_PLACEHOLDER_MAX_LENGTH,
  { allowEmpty: true },
);

export const aiAssistDefinitionSchema = z.object({
  additionalInstructionPlaceholder: aiAssistAdditionalInstructionPlaceholderSchema.optional(),
  description: aiAssistDescriptionSchema,
  fixedInstruction: aiAssistFixedInstructionSchema,
  id: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  isBuiltIn: z.boolean(),
  name: aiAssistNameSchema,
  resultType: aiAssistResultTypeSchema,
  targetType: aiAssistTargetTypeSchema,
});

export const customAiAssistDefinitionSchema = aiAssistDefinitionSchema.extend({
  additionalInstructionPlaceholder: aiAssistAdditionalInstructionPlaceholderSchema,
  isBuiltIn: z.literal(false),
});

export const aiAssistDefinitionInputSchema = z.object({
  additionalInstructionPlaceholder: aiAssistAdditionalInstructionPlaceholderSchema,
  description: aiAssistDescriptionSchema,
  fixedInstruction: aiAssistFixedInstructionSchema,
  name: aiAssistNameSchema,
  resultType: aiAssistResultTypeSchema,
  targetType: aiAssistTargetTypeSchema,
});

export const aiAssistListResponseSchema = z.object({
  assists: z.array(aiAssistDefinitionSchema),
});

export const aiAssistSaveResponseSchema = z.object({
  assist: customAiAssistDefinitionSchema,
});

export type AiAssistDefinition = z.infer<typeof aiAssistDefinitionSchema>;
export type CustomAiAssistDefinition = z.infer<typeof customAiAssistDefinitionSchema>;
export type AiAssistDefinitionInput = z.infer<typeof aiAssistDefinitionInputSchema>;
export type AiAssistListResponse = z.infer<typeof aiAssistListResponseSchema>;
export type AiAssistSaveResponse = z.infer<typeof aiAssistSaveResponseSchema>;
export type AiAssistTargetType = z.infer<typeof aiAssistTargetTypeSchema>;
export type AiAssistResultType = z.infer<typeof aiAssistResultTypeSchema>;

export type AiAssistResultTypeOption = {
  description: string;
  label: string;
  value: AiAssistResultType;
};

export const aiAssistResultTypeOptions: readonly AiAssistResultTypeOption[] = [
  {
    description: "変更内容を確認してから反映できる編集案を作成します。",
    label: "編集案（確認して反映）",
    value: "edit-proposal",
  },
] as const;

const targetRangeSchema = z
  .object({
    end: z.number().int().nonnegative(),
    start: z.number().int().nonnegative(),
  })
  .refine((range) => range.end >= range.start, {
    message: "targetRange.end must be greater than or equal to start",
  });

const optionalAdditionalInstructionSchema = z
  .string()
  .max(500)
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

export const aiAssistExecutionInputSchema = z.object({
  additionalInstruction: optionalAdditionalInstructionSchema,
  assistId: z.string().min(1),
  targetRange: targetRangeSchema,
  workspaceRelativePath: z.string().min(1),
});

export const aiAssistRuntimeSchema = z.literal("vercel-ai");

export const aiAssistExecuteBodySchema = aiAssistExecutionInputSchema.extend({
  editorContent: z.string(),
  roleAssignments: llmProfileRoleAssignmentsSchema.optional(),
  runtime: aiAssistRuntimeSchema,
  selectedModel: z.string().min(1).optional(),
  standardModelSelection: aiAssistStandardModelSelectionSchema.optional(),
  userProfiles: z.array(llmProfileSchema).optional(),
  workspaceRoot: z.string().min(1),
});

export const aiAssistStandardExecuteBodySchema = aiAssistExecuteBodySchema.extend({
  runtime: z.literal("vercel-ai"),
});

export const aiAssistExecutionRunInputSchema = aiAssistExecutionInputSchema.extend({
  editorContent: z.string(),
  workspaceRoot: z.string().min(1),
});

export const standardAiAssistExecutionRunInputSchema = aiAssistExecutionRunInputSchema.extend({
  roleAssignments: llmProfileRoleAssignmentsSchema.optional(),
  standardModelSelection: aiAssistStandardModelSelectionSchema.optional(),
  userProfiles: z.array(llmProfileSchema).optional(),
});

export const aiAssistExecutionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  runtime: aiAssistRuntimeSchema,
});

export type AiAssistExecutionInput = z.infer<typeof aiAssistExecutionInputSchema>;
export type AiAssistExecutionOption = z.infer<typeof aiAssistExecutionOptionSchema>;
export type AiAssistTargetRange = z.infer<typeof targetRangeSchema>;

export type AiAssistTaskInstructions = {
  additionalInstruction?: string;
  fixedInstruction: string;
};

const builtInAiAssistDefinitions = [
  {
    description: "文章表現を改善する編集案を作成します。",
    fixedInstruction:
      "対象テキストの文章表現を改善する編集案を作成してください。意味を変えず、読みやすさと表現の質を高めてください。",
    id: "polish",
    isBuiltIn: true,
    name: "推敲",
    resultType: "edit-proposal",
    targetType: "text",
  },
  {
    description: "誤字脱字や明確な文法上の問題を直す編集案を作成します。",
    fixedInstruction:
      "対象テキストの誤字脱字や明確な文法上の問題を修正する編集案を作成してください。意味や文体を不必要に変えないでください。",
    id: "proofread",
    isBuiltIn: true,
    name: "校正",
    resultType: "edit-proposal",
    targetType: "text",
  },
  {
    description: "既存のルビを尊重し、設定資料や用語集の読みを優先したルビ候補の編集案を作成します。",
    fixedInstruction:
      "対象テキストにルビ候補を追加する編集案を作成してください。既存のルビは尊重し、リーダーモード互換の｜親文字《ルビ》形式を使ってください。設定資料や用語集に読みがあれば優先してください。",
    id: "ruby-suggestions",
    isBuiltIn: true,
    name: "ルビ候補",
    resultType: "edit-proposal",
    targetType: "text",
  },
] as const satisfies readonly AiAssistDefinition[];

export const builtInAiAssists: readonly AiAssistDefinition[] =
  builtInAiAssistDefinitions.map((definition) => aiAssistDefinitionSchema.parse(definition));

const builtInAiAssistById = new Map(builtInAiAssists.map((assist) => [assist.id, assist]));

export function getBuiltInAiAssist(id: string): AiAssistDefinition | null {
  return builtInAiAssistById.get(id) ?? null;
}

export function composeAiAssistTaskInstructions(
  definition: AiAssistDefinition,
  additionalInstruction?: string,
): AiAssistTaskInstructions {
  if (additionalInstruction === undefined) {
    return { fixedInstruction: definition.fixedInstruction };
  }

  return {
    additionalInstruction,
    fixedInstruction: definition.fixedInstruction,
  };
}
