import path from "node:path";

export type RuntimeEnv = Record<string, string | undefined>;

export type ResolveServerDataRootOptions = {
  cwd: string;
  dataRoot?: string;
  env?: RuntimeEnv;
};

function trimmedEnvValue(env: RuntimeEnv | undefined, key: string): string | undefined {
  const value = env?.[key]?.trim();
  return value ? value : undefined;
}

export function resolveServerDataRoot(options: ResolveServerDataRootOptions): string {
  const cwd = options.cwd;
  const env = options.env;

  const explicitDataRoot = options.dataRoot?.trim();
  if (explicitDataRoot) {
    return path.resolve(cwd, explicitDataRoot);
  }

  const ghostwriterDataDir = trimmedEnvValue(env, "GHOSTWRITER_DATA_DIR");
  if (ghostwriterDataDir) {
    return path.resolve(cwd, ghostwriterDataDir);
  }

  const legacyDataDir = trimmedEnvValue(env, "SIMPLE_AI_AGENT_DATA_DIR");
  if (legacyDataDir) {
    return path.resolve(cwd, legacyDataDir);
  }

  return path.resolve(cwd, ".data");
}

export function resolveRipgrepExecutable(env: RuntimeEnv = process.env): string {
  const explicitExecutable = env.GHOSTWRITER_RG_EXECUTABLE?.trim();
  return explicitExecutable ? explicitExecutable : "rg";
}
