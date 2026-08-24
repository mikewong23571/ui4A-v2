import { releaseMetadata } from '@ui4a/shared';

export const WEB_COMPONENT = 'ui4a-web';

export function webReleaseMetadata(environment: NodeJS.ProcessEnv = process.env) {
  return releaseMetadata(WEB_COMPONENT, environment);
}

export function webLivePayload(environment: NodeJS.ProcessEnv = process.env) {
  return { status: 'live' as const, release: webReleaseMetadata(environment) };
}
