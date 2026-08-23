import type { CodingExecutorProfile } from '@ui4a/shared';

function parseProfiles(raw: string): CodingExecutorProfile[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('coding executor profiles must be an array');
  return parsed as CodingExecutorProfile[];
}

/** Strict runtime config: execution must fail honestly when no profile registry exists. */
export function codingExecutorProfilesFromEnvironment(): CodingExecutorProfile[] {
  const raw = process.env.UI4A_CODING_EXECUTOR_PROFILES;
  if (raw === undefined) throw new Error('UI4A_CODING_EXECUTOR_PROFILES is not configured');
  return parseProfiles(raw);
}

/** Activation registry: an absent config is an empty registry, so executor flows cannot activate. */
export function codingExecutorProfileRegistryFromEnvironment(): ReadonlyMap<string, string> {
  const raw = process.env.UI4A_CODING_EXECUTOR_PROFILES;
  if (raw === undefined) return new Map();
  return new Map(
    parseProfiles(raw).map((profile) => [profile.name, profile.executorClass] as const),
  );
}
