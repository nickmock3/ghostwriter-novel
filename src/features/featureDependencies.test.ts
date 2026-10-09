import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, test } from "vitest";

// Keep this allowlist and docs/architecture.md's dependency directions in sync.
const allowedDependencies: Readonly<Record<string, readonly string[]>> = {
  workspace: [],
  "edit-proposals": ["workspace"],
  llm: ["workspace", "edit-proposals"],
  siwc: ["workspace", "edit-proposals", "llm"],
  "ai-agent": ["workspace", "edit-proposals", "llm", "siwc"],
  "ai-chat": ["workspace", "edit-proposals", "llm", "siwc", "ai-agent"],
  "ai-assist": ["workspace", "edit-proposals", "llm", "siwc", "ai-agent", "editor"],
  editor: ["workspace", "edit-proposals"],
  "file-tree": ["workspace", "edit-proposals"],
  reader: ["workspace", "edit-proposals"],
  settings: [
    "workspace", "edit-proposals", "llm", "siwc", "ai-agent",
    "ai-chat", "ai-assist", "editor", "file-tree", "reader",
  ],
};

const featuresRoot = fileURLToPath(new URL("./", import.meta.url));
const projectRoot = path.resolve(featuresRoot, "../..");
const configPath = path.join(projectRoot, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot);
const resolutionCache = ts.createModuleResolutionCache(projectRoot, (name) => name, parsedConfig.options);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(entry.name)
      && !/\.(test|spec)\.tsx?$/.test(entry.name)
      && !/^test-support\.tsx?$/.test(entry.name)
      ? [file] : [];
  }));
  return files.flat().sort();
}

function moduleReferences(source: ts.SourceFile): ts.StringLiteralLike[] {
  const references: ts.StringLiteralLike[] = [];
  const visit = (node: ts.Node): void => {
    let reference: ts.Node | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      reference = node.moduleSpecifier;
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      reference = node.argument.literal;
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      reference = node.moduleReference.expression;
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      reference = node.arguments[0];
    }
    if (reference && ts.isStringLiteralLike(reference)) references.push(reference);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return references;
}

async function dependencyViolations(file: string): Promise<string[]> {
  const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
  const owner = path.relative(featuresRoot, file).split(path.sep)[0];
  const allowed = allowedDependencies[owner] ?? [];
  return moduleReferences(source).flatMap((reference) => {
    const resolved = ts.resolveModuleName(
      reference.text, file, parsedConfig.options, ts.sys, resolutionCache,
    ).resolvedModule?.resolvedFileName;
    // Also reject relative references to absent files in a forbidden feature.
    const targetPath = resolved ?? (reference.text.startsWith(".")
      ? path.resolve(path.dirname(file), reference.text) : undefined);
    if (!targetPath) return [];
    const relativeTarget = path.relative(featuresRoot, targetPath);
    if (relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) return [];
    const target = relativeTarget.split(path.sep)[0];
    const targetModule = relativeTarget.split(path.sep).join("/").replace(/\.tsx?$/, "");
    if (target === owner || allowed.includes(target)) return [];
    const line = source.getLineAndCharacterOfPosition(reference.getStart(source)).line + 1;
    const allowedTargets = allowed.join(", ") || "(none)";
    return [`${path.relative(projectRoot, file).split(path.sep).join("/")}:${line}: ${owner} -> ${targetModule} (${reference.text}); allowed: ${allowedTargets}`];
  });
}

test("production feature imports follow the documented dependency directions", async () => {
  const entries = await readdir(featuresRoot, { withFileTypes: true });
  // New features need an explicit direction instead of silently bypassing checks.
  expect(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort())
    .toEqual(Object.keys(allowedDependencies).sort());
  const files = await sourceFiles(featuresRoot);
  const violations = (await Promise.all(files.map(dependencyViolations))).flat();
  expect(violations, `Forbidden feature dependencies:\n${violations.join("\n")}`).toEqual([]);
});
