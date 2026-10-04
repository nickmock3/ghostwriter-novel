import packageJson from "../../package.json";

export const APP_RAW_VERSION = packageJson.version;

export function formatApplicationVersion(rawVersion: string): string {
  const tagStylePreview = rawVersion.match(/^(\d+\.\d+)preview(\d+)$/);
  if (tagStylePreview) {
    return `v${tagStylePreview[1]} preview ${tagStylePreview[2]}`;
  }

  const semverPreview = rawVersion.match(/^(\d+\.\d+\.\d+)-preview\.(\d+)$/);
  if (semverPreview) {
    return `v${semverPreview[1]} preview ${semverPreview[2]}`;
  }

  return `v${rawVersion}`;
}

export const APP_DISPLAY_VERSION = formatApplicationVersion(APP_RAW_VERSION);
