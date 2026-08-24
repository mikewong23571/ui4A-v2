import type { ProductionDeploymentSettings, ProductionRuntimeProfile } from '@ui4a/shared';

import {
  runRuntimeBackendLifecycle,
  type CanonicalRuntimeResult,
  type RuntimeBackendKind,
  type RuntimeBackendSpi,
  type RuntimeCheckpoint,
  type RuntimeRequest,
  type RuntimeSpecialization,
  type RuntimeSpecializationPort,
  type RuntimeTransition,
  type ServerRuntimeProfile,
} from './backend';

export interface ProductionRuntimeComposition {
  run(input: {
    request: unknown;
    leaseId: string;
    issuedAt: string;
    attempt: number;
    checkpoint?: RuntimeCheckpoint;
    signal: AbortSignal;
    recordTransition(transition: RuntimeTransition): void;
    recordHeartbeat(checkpoint: RuntimeCheckpoint): void;
    now(): number;
  }): Promise<CanonicalRuntimeResult>;
}

interface ProductionRuntimeCompositionOptions {
  runtime: ProductionDeploymentSettings['runtime'];
  backends: Partial<Record<RuntimeBackendKind, RuntimeBackendSpi>>;
  specializations: Record<RuntimeSpecialization, RuntimeSpecializationPort>;
  runnerArtifactImage: string;
  leaseDurationMs: number;
  heartbeatTimeoutMs: number;
}

const BACKEND_KIND: Record<ProductionRuntimeProfile['backend'], RuntimeBackendKind> = {
  kubernetes: 'kubernetes-job',
  host: 'trusted-host',
};

function requestSpecialization(request: unknown): RuntimeSpecialization {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new Error('runtime_request_invalid');
  }
  const specialization = (request as Partial<RuntimeRequest>).specialization;
  if (
    specialization !== 'coding' &&
    specialization !== 'writing' &&
    specialization !== 'authoring'
  ) {
    throw new Error('runtime_request_invalid');
  }
  return specialization;
}

function selectedProfile(
  runtime: ProductionDeploymentSettings['runtime'],
  specialization: RuntimeSpecialization,
): ProductionRuntimeProfile {
  const profileId = runtime.defaultProfiles[specialization];
  const matches = runtime.profiles.filter(
    (profile) => profile.id === profileId && profile.specialization === specialization,
  );
  if (matches.length !== 1) throw new Error('runtime_profile_selection_invalid');
  return matches[0]!;
}

function serverProfile(
  profile: ProductionRuntimeProfile,
  options: Pick<
    ProductionRuntimeCompositionOptions,
    'runnerArtifactImage' | 'leaseDurationMs' | 'heartbeatTimeoutMs'
  >,
): ServerRuntimeProfile {
  return {
    id: profile.id,
    backend: BACKEND_KIND[profile.backend],
    image: profile.backend === 'kubernetes' ? profile.image : options.runnerArtifactImage,
    workspace: {
      rootRef: profile.workspaceRoot,
      retention: 'until-human-decision',
    },
    resources: {
      ...profile.resources,
      timeoutSeconds: profile.timeoutSeconds,
    },
    networkPolicy: profile.networkPolicy,
    leaseDurationMs: options.leaseDurationMs,
    heartbeatTimeoutMs: options.heartbeatTimeoutMs,
  };
}

/**
 * Bind canonical production profiles to the one backend-neutral lifecycle. Selection is entirely
 * deployment-owned: a task contains only its specialization, and the configured default profile
 * determines both the concrete SPI and its sealed execution grants.
 */
export function createProductionRuntimeComposition(
  options: ProductionRuntimeCompositionOptions,
): ProductionRuntimeComposition {
  return {
    async run(input): Promise<CanonicalRuntimeResult> {
      const specialization = requestSpecialization(input.request);
      const profile = serverProfile(selectedProfile(options.runtime, specialization), options);
      return runRuntimeBackendLifecycle({
        request: input.request,
        profile,
        leaseId: input.leaseId,
        issuedAt: input.issuedAt,
        attempt: input.attempt,
        ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
        signal: input.signal,
        backends: options.backends,
        specializations: options.specializations,
        recordTransition: input.recordTransition,
        recordHeartbeat: input.recordHeartbeat,
        now: input.now,
      });
    },
  };
}
