import { describe, expect, it } from "vitest";
import { parseSlashCommandInput, slashCommandSuggestions } from "./slashCommands";

describe("parseSlashCommandInput", () => {
  it("resolves compact aliases after trimming whitespace", () => {
    expect(parseSlashCommandInput("/compact")).toEqual({
      commandId: "compact",
      kind: "command",
    });
    expect(parseSlashCommandInput("  /圧縮  ")).toEqual({
      commandId: "compact",
      kind: "command",
    });
  });

  it("treats normal text and partial command text as messages", () => {
    expect(parseSlashCommandInput("続きを書いて")).toEqual({
      kind: "message",
      message: "続きを書いて",
    });
    expect(parseSlashCommandInput("/compact now")).toEqual({
      kind: "message",
      message: "/compact now",
    });
  });

  it("classifies unsupported exact slash commands as unknown", () => {
    expect(parseSlashCommandInput("/help")).toEqual({
      kind: "unknown",
      raw: "/help",
    });
  });
});

describe("slashCommandSuggestions", () => {
  it("returns command metadata for slash-prefixed input and matches aliases", () => {
    expect(slashCommandSuggestions("/")).toEqual([
      {
        aliases: ["/圧縮"],
        description: "ここまでの会話を圧縮します",
        id: "compact",
        name: "/compact",
      },
    ]);
    expect(slashCommandSuggestions("/圧")).toHaveLength(1);
  });

  it("does not suggest commands for normal text, leading whitespace, or arguments", () => {
    expect(slashCommandSuggestions("続きを書いて")).toEqual([]);
    expect(slashCommandSuggestions(" /")).toEqual([]);
    expect(slashCommandSuggestions("/compact")).toEqual([]);
    expect(slashCommandSuggestions("/compact now")).toEqual([]);
  });
});
