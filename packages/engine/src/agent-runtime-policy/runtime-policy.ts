/** Abstract features an activated specialization requires from its deployment runtime. */
export interface AgentRuntimeRequirement {
  runtimeClass: string;
  requiredFeatures: string[];
  requiredTools?: string[];
  requiredResourceBackends?: string[];
}

/** Server-owned deployable runtime registration. Credentials are deliberately absent. */
export interface AgentRuntimeProfile {
  ref: string;
  version: number;
  runtimeClass: string;
  features: string[];
  tools: string[];
  resourceBackends: string[];
  providerAdapterRef: string;
  available: boolean;
  unavailableReason?: string;
}

/** Stable non-secret runtime identity persisted on the Run birth provenance. */
export interface AgentRuntimeProfileProvenance {
  profileRef: string;
  profileVersion: number;
  runtimeClass: string;
  providerAdapterRef: string;
  negotiatedFeatures: string[];
}

/** Fail-closed result of resolving one exact Runtime Profile. */
export type AgentRuntimeResolution =
  | {
      ok: true;
      profile: AgentRuntimeProfile;
      provenance: AgentRuntimeProfileProvenance;
    }
  | {
      ok: false;
      code:
        | 'runtime-request-override-forbidden'
        | 'runtime-profile-missing'
        | 'runtime-profile-ambiguous'
        | 'runtime-profile-unavailable'
        | 'runtime-class-mismatch'
        | 'runtime-feature-mismatch'
        | 'runtime-tool-mismatch'
        | 'runtime-resource-backend-mismatch';
      reason: string;
    };

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function missing(required: readonly string[], provided: readonly string[]): string[] {
  const available = new Set(provided);
  return sortedUnique(required).filter((value) => !available.has(value));
}

/**
 * Resolve one exact policy-owned Runtime Profile and negotiate declared requirements.
 * Request execution-policy fields are rejected wholesale and no alternate profile is considered.
 */
export function resolveAgentRuntimeProfile(input: {
  requirement: AgentRuntimeRequirement;
  policyProfile: { ref: string; version: number };
  profiles: readonly AgentRuntimeProfile[];
  requestOverrides?: Record<string, unknown>;
}): AgentRuntimeResolution {
  const overrideKeys = Object.keys(input.requestOverrides ?? {}).sort();
  if (overrideKeys.length > 0) {
    return {
      ok: false,
      code: 'runtime-request-override-forbidden',
      reason: `runtime policy cannot be overridden by request fields: ${overrideKeys.join(', ')}`,
    };
  }
  const matches = input.profiles.filter(
    (profile) =>
      profile.ref === input.policyProfile.ref && profile.version === input.policyProfile.version,
  );
  if (matches.length === 0) {
    return {
      ok: false,
      code: 'runtime-profile-missing',
      reason: `runtime profile ${input.policyProfile.ref}@${input.policyProfile.version} is not registered`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: 'runtime-profile-ambiguous',
      reason: `runtime profile ${input.policyProfile.ref}@${input.policyProfile.version} is registered more than once`,
    };
  }
  const profile = matches[0]!;
  if (!profile.available) {
    return {
      ok: false,
      code: 'runtime-profile-unavailable',
      reason: profile.unavailableReason ?? `runtime profile ${profile.ref} is unavailable`,
    };
  }
  if (profile.runtimeClass !== input.requirement.runtimeClass) {
    return {
      ok: false,
      code: 'runtime-class-mismatch',
      reason: `runtime profile ${profile.ref} does not satisfy class ${input.requirement.runtimeClass}`,
    };
  }
  const missingFeatures = missing(input.requirement.requiredFeatures, profile.features);
  if (missingFeatures.length > 0) {
    return {
      ok: false,
      code: 'runtime-feature-mismatch',
      reason: `runtime profile ${profile.ref} lacks features: ${missingFeatures.join(', ')}`,
    };
  }
  const missingTools = missing(input.requirement.requiredTools ?? [], profile.tools);
  if (missingTools.length > 0) {
    return {
      ok: false,
      code: 'runtime-tool-mismatch',
      reason: `runtime profile ${profile.ref} lacks tools: ${missingTools.join(', ')}`,
    };
  }
  const missingBackends = missing(
    input.requirement.requiredResourceBackends ?? [],
    profile.resourceBackends,
  );
  if (missingBackends.length > 0) {
    return {
      ok: false,
      code: 'runtime-resource-backend-mismatch',
      reason: `runtime profile ${profile.ref} lacks resource backends: ${missingBackends.join(', ')}`,
    };
  }
  return {
    ok: true,
    profile,
    provenance: {
      profileRef: profile.ref,
      profileVersion: profile.version,
      runtimeClass: profile.runtimeClass,
      providerAdapterRef: profile.providerAdapterRef,
      negotiatedFeatures: sortedUnique(input.requirement.requiredFeatures),
    },
  };
}

/** One concrete resource and its mechanically authorized operations. */
export interface AgentResourceGrantScope {
  category: string;
  resourceRef: string;
  permissions: string[];
}

/** Concrete grants after an authorization layer has evaluated a principal and resource. */
export interface AgentGrantSet {
  tools: string[];
  resources: AgentResourceGrantScope[];
  contextSources: string[];
  artifactMediaTypes: string[];
  limits?: AgentGrantLimits;
}

/** Optional quantitative ceilings; lower values are always more restrictive. */
export interface AgentGrantLimits {
  contextMaxItems?: number;
  artifactMaxCount?: number;
  artifactMaxBytes?: number;
}

/** Agent Definition ceiling; resource categories are abstract, never host resource identifiers. */
export interface AgentDefinitionGrantCeiling {
  tools: string[];
  resourceCategories: string[];
  contextSources: string[];
  artifactMediaTypes: string[];
  limits?: AgentGrantLimits;
}

/** Replayable grant approval or terminal revocation for one durable Agent Run. */
export type AgentRunGrantEvent =
  | {
      type: 'approved';
      grantId: string;
      atEpochMs: number;
      expiresAtEpochMs?: number;
      grants: AgentGrantSet;
    }
  | { type: 'revoked'; grantId: string; atEpochMs: number };

function intersectStrings(...layers: readonly string[][]): string[] {
  if (layers.length === 0) return [];
  return sortedUnique(layers[0]!).filter((value) =>
    layers.slice(1).every((layer) => layer.includes(value)),
  );
}

function resourceKey(resource: AgentResourceGrantScope): string {
  return `${resource.category}\u0000${resource.resourceRef}`;
}

function mergeResources(resources: readonly AgentResourceGrantScope[]): AgentResourceGrantScope[] {
  const merged = new Map<string, AgentResourceGrantScope>();
  for (const resource of resources) {
    const key = resourceKey(resource);
    const current = merged.get(key);
    merged.set(key, {
      category: resource.category,
      resourceRef: resource.resourceRef,
      permissions: sortedUnique([...(current?.permissions ?? []), ...resource.permissions]),
    });
  }
  return [...merged.values()].sort((left, right) =>
    resourceKey(left).localeCompare(resourceKey(right)),
  );
}

function intersectResources(
  categories: readonly string[],
  ...layers: readonly AgentResourceGrantScope[][]
): AgentResourceGrantScope[] {
  if (layers.length === 0) return [];
  const maps = layers.map(
    (layer) => new Map(mergeResources(layer).map((resource) => [resourceKey(resource), resource])),
  );
  const output: AgentResourceGrantScope[] = [];
  for (const first of maps[0]!.values()) {
    if (!categories.includes(first.category)) continue;
    const matching = maps.slice(1).map((map) => map.get(resourceKey(first)));
    if (matching.some((resource) => resource === undefined)) continue;
    const permissions = intersectStrings(
      first.permissions,
      ...matching.map((resource) => resource!.permissions),
    );
    if (permissions.length > 0) output.push({ ...first, permissions });
  }
  return output.sort((left, right) => resourceKey(left).localeCompare(resourceKey(right)));
}

function upperCeiling(input: {
  definition: AgentDefinitionGrantCeiling;
  application: AgentGrantSet;
  principal: AgentGrantSet;
}): AgentGrantSet {
  return withLimits(
    {
      tools: intersectStrings(
        input.definition.tools,
        input.application.tools,
        input.principal.tools,
      ),
      resources: intersectResources(
        input.definition.resourceCategories,
        input.application.resources,
        input.principal.resources,
      ),
      contextSources: intersectStrings(
        input.definition.contextSources,
        input.application.contextSources,
        input.principal.contextSources,
      ),
      artifactMediaTypes: intersectStrings(
        input.definition.artifactMediaTypes,
        input.application.artifactMediaTypes,
        input.principal.artifactMediaTypes,
      ),
    },
    intersectLimits(input.definition.limits, input.application.limits, input.principal.limits),
  );
}

function intersectLimits(
  ...layers: readonly (AgentGrantLimits | undefined)[]
): AgentGrantLimits | undefined {
  const output: AgentGrantLimits = {};
  for (const key of ['contextMaxItems', 'artifactMaxCount', 'artifactMaxBytes'] as const) {
    const values = layers
      .map((layer) => layer?.[key])
      .filter((value): value is number => value !== undefined);
    if (values.length > 0) output[key] = Math.min(...values);
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function withLimits<T extends AgentGrantSet>(
  value: Omit<T, 'limits'>,
  limits: AgentGrantLimits | undefined,
): T {
  return (limits === undefined ? value : { ...value, limits }) as T;
}

function valuesOutside(requested: readonly string[], ceiling: readonly string[]): string[] {
  return sortedUnique(requested).filter((value) => !ceiling.includes(value));
}

/** Reject a proposed per-Run grant when any field would widen the three upper policy layers. */
export function decideRunGrantApproval(input: {
  requested: AgentGrantSet;
  definition: AgentDefinitionGrantCeiling;
  application: AgentGrantSet;
  principal: AgentGrantSet;
}): { allowed: true; grants: AgentGrantSet } | { allowed: false; reason: string } {
  const ceiling = upperCeiling(input);
  for (const [label, requested, allowed] of [
    ['tools', input.requested.tools, ceiling.tools],
    ['context sources', input.requested.contextSources, ceiling.contextSources],
    ['artifact media types', input.requested.artifactMediaTypes, ceiling.artifactMediaTypes],
  ] as const) {
    const outside = valuesOutside(requested, allowed);
    if (outside.length > 0) {
      return {
        allowed: false,
        reason: `${label} exceed the effective upper grant ceiling: ${outside.join(', ')}`,
      };
    }
  }
  const requestedResources = mergeResources(input.requested.resources);
  const allowedResources = new Map(
    ceiling.resources.map((resource) => [resourceKey(resource), resource]),
  );
  for (const resource of requestedResources) {
    const allowed = allowedResources.get(resourceKey(resource));
    if (allowed === undefined) {
      return {
        allowed: false,
        reason: `resource exceeds the effective upper grant ceiling: ${resource.category}/${resource.resourceRef}`,
      };
    }
    const outside = valuesOutside(resource.permissions, allowed.permissions);
    if (outside.length > 0) {
      return {
        allowed: false,
        reason: `resource permissions exceed the effective upper grant ceiling: ${resource.category}/${resource.resourceRef} (${outside.join(', ')})`,
      };
    }
  }
  for (const key of ['contextMaxItems', 'artifactMaxCount', 'artifactMaxBytes'] as const) {
    const requested = input.requested.limits?.[key];
    const allowed = ceiling.limits?.[key];
    if (requested !== undefined && (allowed === undefined || requested > allowed)) {
      return {
        allowed: false,
        reason: `${key} exceeds the effective upper grant ceiling: ${requested}`,
      };
    }
  }
  return {
    allowed: true,
    grants: withLimits(
      {
        tools: sortedUnique(input.requested.tools),
        resources: requestedResources,
        contextSources: sortedUnique(input.requested.contextSources),
        artifactMediaTypes: sortedUnique(input.requested.artifactMediaTypes),
      },
      input.requested.limits,
    ),
  };
}

function replayActiveApprovals(
  events: readonly AgentRunGrantEvent[],
  nowEpochMs: number,
): { grantIds: string[]; grants: AgentGrantSet } {
  const active = new Map<string, Extract<AgentRunGrantEvent, { type: 'approved' }>>();
  const revoked = new Set<string>();
  for (const event of events) {
    if (event.atEpochMs > nowEpochMs) continue;
    if (event.type === 'revoked') {
      revoked.add(event.grantId);
      active.delete(event.grantId);
    } else if (!revoked.has(event.grantId) && !active.has(event.grantId)) {
      active.set(event.grantId, event);
    }
  }
  const approvals = [...active.values()].filter(
    (event) => event.expiresAtEpochMs === undefined || event.expiresAtEpochMs > nowEpochMs,
  );
  return {
    grantIds: approvals.map((event) => event.grantId).sort(),
    grants: withLimits(
      {
        tools: sortedUnique(approvals.flatMap((event) => event.grants.tools)),
        resources: mergeResources(approvals.flatMap((event) => event.grants.resources)),
        contextSources: sortedUnique(approvals.flatMap((event) => event.grants.contextSources)),
        artifactMediaTypes: sortedUnique(
          approvals.flatMap((event) => event.grants.artifactMediaTypes),
        ),
      },
      intersectLimits(...approvals.map((event) => event.grants.limits)),
    ),
  };
}

/** Replay run approvals and compute the four-way, narrowing-only effective grant projection. */
export function computeEffectiveAgentGrants(input: {
  definition: AgentDefinitionGrantCeiling;
  application: AgentGrantSet;
  principal: AgentGrantSet;
  approvalEvents: readonly AgentRunGrantEvent[];
  nowEpochMs: number;
}): { grants: AgentGrantSet; activeGrantIds: string[] } {
  const approved = replayActiveApprovals(input.approvalEvents, input.nowEpochMs);
  return {
    grants: withLimits(
      {
        tools: intersectStrings(
          input.definition.tools,
          input.application.tools,
          input.principal.tools,
          approved.grants.tools,
        ),
        resources: intersectResources(
          input.definition.resourceCategories,
          input.application.resources,
          input.principal.resources,
          approved.grants.resources,
        ),
        contextSources: intersectStrings(
          input.definition.contextSources,
          input.application.contextSources,
          input.principal.contextSources,
          approved.grants.contextSources,
        ),
        artifactMediaTypes: intersectStrings(
          input.definition.artifactMediaTypes,
          input.application.artifactMediaTypes,
          input.principal.artifactMediaTypes,
          approved.grants.artifactMediaTypes,
        ),
      },
      intersectLimits(
        input.definition.limits,
        input.application.limits,
        input.principal.limits,
        approved.grants.limits,
      ),
    ),
    activeGrantIds: approved.grantIds,
  };
}
