export type SlashCommandId = "compact";

export type SlashCommandDefinition = {
  aliases: readonly string[];
  description: string;
  id: SlashCommandId;
  name: string;
};

export const SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  {
    aliases: ["/圧縮"],
    description: "ここまでの会話を圧縮します",
    id: "compact",
    name: "/compact",
  },
];

const COMMANDS_BY_ALIAS = new Map(
  SLASH_COMMANDS.flatMap((command) =>
    [command.name, ...command.aliases].map((alias) => [alias, command] as const),
  ),
);

export type ParsedSlashCommandInput =
  | { commandId: SlashCommandId; kind: "command" }
  | { kind: "message"; message: string }
  | { kind: "unknown"; raw: string };

function isExactSlashCommand(input: string): boolean {
  return input.startsWith("/") && !/\s/.test(input.slice(1));
}

export function slashCommandSuggestions(input: string): readonly SlashCommandDefinition[] {
  if (!isExactSlashCommand(input)) {
    return [];
  }

  return SLASH_COMMANDS.filter((command) =>
    [command.name, ...command.aliases].some((alias) => alias !== input && alias.startsWith(input)),
  );
}

export function parseSlashCommandInput(input: string): ParsedSlashCommandInput {
  const trimmed = input.trim();
  const command = COMMANDS_BY_ALIAS.get(trimmed);

  if (command) {
    return { commandId: command.id, kind: "command" };
  }

  if (isExactSlashCommand(trimmed)) {
    return { kind: "unknown", raw: trimmed };
  }

  return { kind: "message", message: trimmed };
}
