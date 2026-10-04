import type { LlmProfile } from "../llmProfiles";

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isCloudOpenAICompatibleBaseURL(baseURL?: string) {
  if (!baseURL) {
    return false;
  }

  try {
    const parsedUrl = new URL(baseURL);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return false;
    }

    return !isLoopbackHostname(parsedUrl.hostname);
  } catch {
    return false;
  }
}

export function supportsOpenAICompatibleProfileTools(
  profile: Pick<LlmProfile, "baseURL" | "supportsToolsOverride">,
) {
  if (profile.supportsToolsOverride === true) {
    return true;
  }

  return isCloudOpenAICompatibleBaseURL(profile.baseURL);
}
