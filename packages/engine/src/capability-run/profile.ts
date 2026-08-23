import { CODING_EXECUTOR_SCHEMA_VERSION } from '@ui4a/shared';
import type { CodingExecutorDescriptor, CodingExecutorProfile } from '@ui4a/shared';

export type ExecutorProfile = CodingExecutorProfile;

export interface ExecutorRequirement {
  executorClass: string;
  requiredFeatures?: string[];
  taskSchemaVersion?: number;
}

export interface ExecutorProfileResolutionInput {
  requirement: ExecutorRequirement;
  policyProfileName: string;
  profiles: readonly ExecutorProfile[];
  descriptors: readonly CodingExecutorDescriptor[];
  /** Untrusted request fields. Any execution-policy key here is rejected, never applied. */
  request?: Record<string, unknown>;
}

export type ExecutorProfileResolution =
  | { ok: true; profile: ExecutorProfile; descriptor: CodingExecutorDescriptor }
  | {
      ok: false;
      code:
        | 'request-override-forbidden'
        | 'profile-missing'
        | 'profile-class-mismatch'
        | 'profile-unavailable'
        | 'profile-incompatible';
      reason: string;
    };

/** Resolve exactly one policy-owned profile. This function deliberately has no fallback path. */
export function resolveExecutorProfile(
  input: ExecutorProfileResolutionInput,
): ExecutorProfileResolution {
  const requestKeys = Object.keys(input.request ?? {});
  if (requestKeys.length > 0) {
    return {
      ok: false,
      code: 'request-override-forbidden',
      reason: `executor policy cannot be overridden by request fields: ${requestKeys.sort().join(', ')}`,
    };
  }
  const profile = input.profiles.find((candidate) => candidate.name === input.policyProfileName);
  if (profile === undefined) {
    return {
      ok: false,
      code: 'profile-missing',
      reason: `executor profile ${input.policyProfileName} is not registered`,
    };
  }
  if (profile.executorClass !== input.requirement.executorClass) {
    return {
      ok: false,
      code: 'profile-class-mismatch',
      reason: `executor profile ${profile.name} does not satisfy class ${input.requirement.executorClass}`,
    };
  }
  const descriptor = input.descriptors.find(
    (candidate) => candidate.profileName === input.policyProfileName,
  );
  if (descriptor === undefined || descriptor.available !== true) {
    return {
      ok: false,
      code: 'profile-unavailable',
      reason: descriptor?.reason ?? `executor profile ${profile.name} has no healthy probe`,
    };
  }
  const taskVersion = input.requirement.taskSchemaVersion ?? CODING_EXECUTOR_SCHEMA_VERSION;
  const missingFeatures = (input.requirement.requiredFeatures ?? []).filter(
    (feature) => !descriptor.features.includes(feature),
  );
  if (!descriptor.taskSchemaVersions.includes(taskVersion) || missingFeatures.length > 0) {
    return {
      ok: false,
      code: 'profile-incompatible',
      reason:
        missingFeatures.length > 0
          ? `executor profile ${profile.name} lacks features: ${missingFeatures.join(', ')}`
          : `executor profile ${profile.name} does not support task schema ${taskVersion}`,
    };
  }
  return { ok: true, profile, descriptor };
}
