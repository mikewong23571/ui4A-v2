/** Process lifecycle used independently from liveness and dependency health. */
export type ReadinessLifecycle = 'starting' | 'serving' | 'draining';

/** Bounded dependency state; adapters normalize exceptions before aggregation. */
export type ReadinessDependencyStatus = 'ok' | 'degraded' | 'error' | 'unknown';

/** One server-owned dependency check supplied to the pure readiness aggregator. */
export interface ReadinessDependencyInput {
  readonly required: boolean;
  readonly status: ReadinessDependencyStatus;
  readonly reasonCode?: string;
}

/** Platform-neutral input shared by Web, Worker, and Runner adapters. */
export interface ReadinessInput {
  readonly component: string;
  readonly lifecycle: ReadinessLifecycle;
  readonly dependencies: Readonly<Record<string, ReadinessDependencyInput>>;
}

/** Detached readiness snapshot safe to expose from process-specific HTTP adapters. */
export interface ReadinessResult {
  readonly schemaVersion: 1;
  readonly component: string;
  readonly lifecycle: ReadinessLifecycle;
  readonly status: 'ready' | 'not-ready';
  readonly health: 'ok' | 'degraded';
  readonly reasonCodes: string[];
  readonly dependencies: Record<string, ReadinessDependencyInput>;
}

function lifecycleReason(lifecycle: ReadinessLifecycle): string | undefined {
  if (lifecycle === 'starting') return 'process_starting';
  if (lifecycle === 'draining') return 'process_draining';
  return undefined;
}

/**
 * Aggregate lifecycle and normalized dependency facts without retaining input objects or copying
 * adapter diagnostics. Required failures remove readiness; optional failures only degrade health.
 */
export function aggregateReadiness(input: ReadinessInput): ReadinessResult {
  const entries = Object.entries(input.dependencies).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const dependencies = Object.fromEntries(
    entries.map(([name, dependency]) => [
      name,
      {
        required: dependency.required,
        status: dependency.status,
        ...(dependency.reasonCode === undefined ? {} : { reasonCode: dependency.reasonCode }),
      } satisfies ReadinessDependencyInput,
    ]),
  );
  const lifecycleCode = lifecycleReason(input.lifecycle);
  const reasonCodes = [
    ...(lifecycleCode === undefined ? [] : [lifecycleCode]),
    ...entries.flatMap(([, dependency]) =>
      dependency.status === 'ok' || dependency.reasonCode === undefined
        ? []
        : [dependency.reasonCode],
    ),
  ].sort();
  const dependenciesHealthy = entries.every(([, dependency]) => dependency.status === 'ok');
  const requiredReady = entries.every(
    ([, dependency]) => !dependency.required || dependency.status === 'ok',
  );

  return {
    schemaVersion: 1,
    component: input.component,
    lifecycle: input.lifecycle,
    status: input.lifecycle === 'serving' && requiredReady ? 'ready' : 'not-ready',
    health: dependenciesHealthy ? 'ok' : 'degraded',
    reasonCodes,
    dependencies,
  };
}
