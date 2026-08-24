// Kept local so the installable CLI remains dependency-free; T22's repository-level
// release contract test mechanically aligns these values with @ui4a/shared.
export const CLI_VERSION = '0.1.0-experimental.1' as const;
export const CLI_RELEASE_TAG = `v${CLI_VERSION}` as const;
export const CLI_RELEASE_CHANNEL = 'experimental' as const;

export function cliVersionLine(): string {
  return `ui4a ${CLI_RELEASE_TAG} (${CLI_RELEASE_CHANNEL})`;
}
