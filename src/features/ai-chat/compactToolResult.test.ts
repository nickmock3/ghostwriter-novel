import { describe, expect, it } from "vitest";
import {
  COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS,
  summarizeCompactToolResult,
} from "./compactToolResult";

describe("compact tool result summaries", () => {
  it.each([
    {
      input: { path: "manuscript/chapter-01.txt" },
      output: {
        content: "secret full manuscript\nsecond line",
        path: "manuscript/chapter-01.txt",
        totalLines: 2,
        truncated: false,
      },
      toolName: "Read",
      expected: ["manuscript/chapter-01.txt", "completed", "2 lines", "truncated=false"],
      excluded: ["secret full manuscript"],
    },
    {
      input: { query: "hero" },
      output: {
        matches: [
          { line: "secret snippet", lineNumber: 1, path: "a.txt" },
          { line: "another secret", lineNumber: 2, path: "b.txt" },
        ],
        truncated: false,
      },
      toolName: "Grep",
      expected: ["hero", "2 matches", "a.txt", "b.txt"],
      excluded: ["secret snippet", "another secret"],
    },
    {
      input: { path: "manuscript/chapter-01.txt", newText: "secret replacement" },
      output: { path: "manuscript/chapter-01.txt", newText: "secret replacement", status: "pending" },
      toolName: "Edit",
      expected: ["edit", "manuscript/chapter-01.txt", "completed"],
      excluded: ["secret replacement"],
    },
  ])("keeps bounded decision metadata for $toolName without raw content", ({
    excluded,
    expected,
    input,
    output,
    toolName,
  }) => {
    const summary = summarizeCompactToolResult({ input, output, toolName });

    for (const value of expected) expect(summary).toContain(value);
    for (const value of excluded) expect(summary).not.toContain(value);
    expect(summary.length).toBeLessThanOrEqual(COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS);
  });

  it("uses a fixed truncation marker and deterministic output", () => {
    const input = { query: "q".repeat(800) };
    const output = { message: "d".repeat(800), status: "completed" };

    const first = summarizeCompactToolResult({ input, output, toolName: "PluginTool" });
    const second = summarizeCompactToolResult({ input, output, toolName: "PluginTool" });

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS);
    expect(first).toMatch(/\[truncated\]$/);
  });

  it("preserves status, line count, and truncated state when a Read path must be shortened", () => {
    const summary = summarizeCompactToolResult({
      input: { path: `manuscript/${"chapter".repeat(100)}.txt` },
      output: { content: "raw manuscript", totalLines: 2400, truncated: true },
      toolName: "Read",
    });

    expect(summary.length).toBeLessThanOrEqual(COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS);
    expect(summary).toContain("manuscript/");
    expect(summary).toContain("completed");
    expect(summary).toContain("2400 lines");
    expect(summary).toContain("truncated=true");
    expect(summary).toContain("[truncated]");
    expect(summary).not.toContain("raw manuscript");
  });

  it("bounds unknown tool names and statuses as well as their detail", () => {
    const summary = summarizeCompactToolResult({
      input: { query: "q".repeat(800) },
      output: { status: "s".repeat(800) },
      toolName: "PluginTool".repeat(100),
    });

    expect(summary.length).toBeLessThanOrEqual(COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS);
    expect(summary).toContain("PluginTool");
    expect(summary).toContain("ssss");
    expect(summary).toContain("[truncated]");
  });

  it.each([
    {
      input: { query: "hero journey" },
      output: {
        results: [
          { lineNumber: 1, path: "notes/a.md", score: 1, snippet: "secret snippet" },
          { lineNumber: 2, path: "notes/b.md", score: 1, snippet: "another secret" },
        ],
        truncated: false,
      },
      toolName: "Search",
      expected: ["hero journey", "2 matches", "notes/a.md", "notes/b.md"],
      excluded: ["secret snippet"],
    },
    {
      input: { pattern: "**/*.txt" },
      output: { matches: ["a.txt", "b.txt"], truncated: false },
      toolName: "Glob",
      expected: ["**/*.txt", "2 matches", "a.txt", "b.txt"],
      excluded: [],
    },
    {
      input: { path: "docs/new.md", content: "secret draft" },
      output: { path: "docs/new.md", status: "pending" },
      toolName: "Create",
      expected: ["create", "docs/new.md", "completed"],
      excluded: ["secret draft"],
    },
    {
      input: { path: "drafts/new" },
      output: { path: "drafts/new", status: "pending" },
      toolName: "CreateDirectory",
      expected: ["createDirectory", "drafts/new", "completed"],
      excluded: [],
    },
    {
      input: { path: "missing.txt" },
      output: { error: "file not found" },
      toolName: "Read",
      expected: ["missing.txt", "failed", "file not found"],
      excluded: [],
    },
    {
      input: { instruction: "Rewrite opening", targetPath: "manuscript/chapter-01.txt" },
      output: {
        artifactId: "artifact-abc",
        latencyMs: 42,
        operation: "create",
        status: "completed",
        targetPath: "manuscript/chapter-01.txt",
        tokenUsage: { llmProfileRole: "writing", modelId: "writing-model", providerId: "deepseek" },
        oldText: "secret old manuscript",
        newText: "secret new manuscript",
        diff: "--- manuscript/chapter-01.txt",
      },
      toolName: "DelegateWriting",
      expected: ["DelegateWriting", "manuscript/chapter-01.txt", "completed", "artifactId=artifact-abc", "latencyMs=42", "operation=create"],
      excluded: ["secret old manuscript", "secret new manuscript", "--- manuscript"],
    },
    {
      input: { artifactId: "artifact-abc" },
      output: {
        createdAt: "2026-06-20T00:00:00.000Z",
        diff: "--- manuscript/chapter-01.txt\n+++ manuscript/chapter-01.txt",
        id: "proposal-1",
        newText: "secret new manuscript",
        oldText: "secret old manuscript",
        operation: "edit",
        path: "manuscript/chapter-01.txt",
        sourceRole: "writing",
        status: "pending",
        title: "Edit manuscript/chapter-01.txt",
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
      toolName: "CreateWritingEditProposal",
      expected: [
        "CreateWritingEditProposal",
        "artifact-abc",
        "completed",
        "manuscript/chapter-01.txt",
        "operation=edit",
        "sourceRole=writing",
      ],
      excluded: ["secret old manuscript", "secret new manuscript", "--- manuscript"],
    },
  ])("keeps bounded metadata for additional tool types ($toolName)", ({
    excluded,
    expected,
    input,
    output,
    toolName,
  }) => {
    const summary = summarizeCompactToolResult({ input, output, toolName });

    for (const value of expected) expect(summary).toContain(value);
    for (const value of excluded) expect(summary).not.toContain(value);
    expect(summary.length).toBeLessThanOrEqual(COMPACT_TOOL_RESULT_SUMMARY_MAX_CHARS);
  });

  it("formats CreateWritingEditProposal summaries with comma-separated metadata", () => {
    const summary = summarizeCompactToolResult({
      input: { artifactId: "artifact-abc" },
      output: {
        createdAt: "2026-06-20T00:00:00.000Z",
        diff: "--- manuscript/chapter-01.txt\n+++ manuscript/chapter-01.txt",
        id: "proposal-1",
        newText: "secret new manuscript",
        oldText: "secret old manuscript",
        operation: "edit",
        path: "manuscript/chapter-01.txt",
        sourceRole: "writing",
        status: "pending",
        title: "Edit manuscript/chapter-01.txt",
        updatedAt: "2026-06-20T00:00:00.000Z",
      },
      toolName: "CreateWritingEditProposal",
    });

    expect(summary).toBe(
      "CreateWritingEditProposal artifact-abc: completed, manuscript/chapter-01.txt, operation=edit, sourceRole=writing",
    );
  });
});
