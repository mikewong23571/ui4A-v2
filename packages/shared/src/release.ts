export const RELEASE_VERSION = '0.1.0-experimental.1' as const;
export const RELEASE_TAG = `v${RELEASE_VERSION}` as const;
export const RELEASE_CHANNEL = 'experimental' as const;

export const RELEASE_SUPPORT = Object.freeze({
  ga: false,
  productionReady: false,
  sla: false,
  lts: false,
} as const);

export interface ReleaseEnvironment {
  [name: string]: string | undefined;
  UI4A_VERSION?: string;
  UI4A_GIT_SHA?: string;
  UI4A_BUILD_DATE?: string;
}

export interface ReleaseMetadata<Component extends string = string> {
  component: Component;
  version: typeof RELEASE_VERSION;
  tag: typeof RELEASE_TAG;
  channel: typeof RELEASE_CHANNEL;
  support: typeof RELEASE_SUPPORT;
  gitSha: string;
  buildDate: string;
}

function provenance(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? 'unknown' : normalized;
}

export function releaseMetadata<Component extends string>(
  component: Component,
  environment: ReleaseEnvironment = {},
): ReleaseMetadata<Component> {
  const injectedVersion = environment.UI4A_VERSION?.trim();
  if (injectedVersion !== undefined && injectedVersion !== RELEASE_VERSION) {
    throw new Error(`UI4A_VERSION must match canonical release ${RELEASE_VERSION}`);
  }
  return {
    component,
    version: RELEASE_VERSION,
    tag: RELEASE_TAG,
    channel: RELEASE_CHANNEL,
    support: RELEASE_SUPPORT,
    gitSha: provenance(environment.UI4A_GIT_SHA),
    buildDate: provenance(environment.UI4A_BUILD_DATE),
  };
}
