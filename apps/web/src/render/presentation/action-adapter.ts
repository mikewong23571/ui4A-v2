/**
 * Live boundary between a hydrated Surface control and the business action gate.
 *
 * A Surface contributes only an exact subject/action reference plus transient input. The adapter
 * reloads Siren immediately before every submit, fails closed on stale declaration/guard/schema
 * state, then rebuilds the existing action gate from that fresh entity. It never persists enabled
 * state, guard results or form data.
 */
import type { SirenAction, SirenEntity } from '@ui4a/engine';

import { blockedForRenderer } from '../../components/actions/action-group';
import { createActionGate, type CanvasClientAction, type GateExecFn } from '../canvas/action-gate';

export interface SurfaceActionDependencyExpectation {
  /** Must be the exact subject being acted on; visual indexes and collection fallbacks are invalid. */
  subject: string;
  version: string;
}

export interface SurfaceActionExpectation {
  /** Ephemeral schema used to render the current form; never a Sidecar-owned fact. */
  actionSchema?: Record<string, unknown>;
  /** Optional structural dependency captured by the hydrated Surface. */
  dependency?: SurfaceActionDependencyExpectation;
}

export interface SurfaceActionSubmission {
  subject: string;
  action: string;
  params?: Record<string, unknown>;
  expected?: SurfaceActionExpectation;
  /** Additional subjects (for example a parent collection) whose hydrated views should refresh. */
  refreshSubjects?: readonly string[];
}

export type SurfaceActionRefusalCode =
  | 'invalid-reference'
  | 'reload-failed'
  | 'entity-missing'
  | 'action-undeclared'
  | 'action-ambiguous'
  | 'guard-state-invalid'
  | 'guard-blocked'
  | 'schema-stale'
  | 'dependency-unverifiable'
  | 'dependency-stale'
  | 'exec-refused';

export interface SurfaceActionExecuted {
  outcome: 'executed';
  subject: string;
  action: string;
  entity: SirenEntity;
  refreshSubjects: string[];
}

export interface SurfaceActionRefused {
  outcome: 'refused';
  subject: string;
  action: string;
  code: SurfaceActionRefusalCode;
  reason: string;
  /** True means the control's structural Surface dependency can no longer be trusted. */
  stale: boolean;
  status?: number;
  layer?: string;
  expectedVersion?: string;
  currentVersion?: string | null;
}

export type SurfaceActionOutcome = SurfaceActionExecuted | SurfaceActionRefused;

export interface SurfaceActionAdapter {
  submit(input: SurfaceActionSubmission): Promise<SurfaceActionOutcome>;
}

export type SurfaceEntityFetcher = (subject: string) => Promise<SirenEntity | null>;

export type SurfaceDependencyVersionResolver = (input: {
  subject: string;
  entity: SirenEntity;
}) => Promise<string | null> | string | null;

export interface SurfaceActionAdapterDependencies {
  fetchEntity: SurfaceEntityFetcher;
  exec: GateExecFn;
  resolveDependencyVersion?: SurfaceDependencyVersionResolver;
}

function refusal(
  input: SurfaceActionSubmission,
  code: SurfaceActionRefusalCode,
  reason: string,
  stale: boolean,
  details: Pick<
    SurfaceActionRefused,
    'status' | 'layer' | 'expectedVersion' | 'currentVersion'
  > = {},
): SurfaceActionRefused {
  return {
    outcome: 'refused',
    subject: input.subject,
    action: input.action,
    code,
    reason,
    stale,
    ...details,
  };
}

function normalizedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizedJson(entry)]),
  );
}

/** Stable structural comparison for JSON Schemas; object property order is irrelevant. */
export function sameActionSchema(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return JSON.stringify(normalizedJson(left)) === JSON.stringify(normalizedJson(right));
}

function liveActionOf(entity: SirenEntity, name: string): SirenAction[] {
  return entity.actions.filter((action) => action.name === name);
}

function guardResultsOf(entity: SirenEntity, name: string) {
  return (entity['guard-results'] ?? []).filter((result) => result.action === name);
}

function clientActionOf(input: SurfaceActionSubmission): CanvasClientAction {
  return {
    name: input.action,
    surfaceId: 'presentation-action-adapter',
    sourceComponentId: `${input.subject}:${input.action}`,
    timestamp: 'live-submit',
    context: {
      rel: input.subject,
      ...(input.params === undefined ? {} : { params: input.params }),
    },
  };
}

function refreshSubjectsOf(input: SurfaceActionSubmission, result: SirenEntity): string[] {
  const resultRel = result.properties.rel;
  return [
    ...new Set(
      [
        input.subject,
        ...(input.refreshSubjects ?? []),
        ...(typeof resultRel === 'string' ? [resultRel] : []),
      ].filter((subject) => subject.trim() !== ''),
    ),
  ];
}

/** Create a stateless adapter. Each submit owns one fresh entity read and at most one exec call. */
export function createSurfaceActionAdapter(
  dependencies: SurfaceActionAdapterDependencies,
): SurfaceActionAdapter {
  return {
    async submit(input) {
      if (input.subject.trim() === '' || input.action.trim() === '') {
        return refusal(
          input,
          'invalid-reference',
          'Surface action requires an exact non-empty subject and action',
          true,
        );
      }

      let entity: SirenEntity | null;
      try {
        entity = await dependencies.fetchEntity(input.subject);
      } catch (error) {
        return refusal(
          input,
          'reload-failed',
          error instanceof Error ? error.message : String(error),
          false,
        );
      }
      if (entity === null) {
        return refusal(input, 'entity-missing', `Entity "${input.subject}" no longer exists`, true);
      }
      // T35 F-17:服务端是身份权威——fresh read 按注视 subject 发起,服务端
      // flow 别名可能以实例 rel 返回同一实体;采纳规范 rel 作为 exec 目标,
      // 后续 action/guard/schema 校验全部针对返回实体本身(失败仍关闭)。
      const targetRel =
        typeof entity.properties.rel === 'string' && entity.properties.rel !== ''
          ? entity.properties.rel
          : input.subject;

      const actions = liveActionOf(entity, input.action);
      if (actions.length === 0) {
        return refusal(
          input,
          'action-undeclared',
          `Action "${input.action}" is no longer declared by "${input.subject}"`,
          true,
        );
      }
      if (actions.length !== 1) {
        return refusal(
          input,
          'action-ambiguous',
          `Action "${input.action}" has ${actions.length} live declarations`,
          true,
        );
      }
      const [liveAction] = actions;

      const guardResults = guardResultsOf(entity, input.action);
      if (guardResults.length > 1) {
        return refusal(
          input,
          'guard-state-invalid',
          `Action "${input.action}" has ambiguous live guard results`,
          true,
        );
      }
      // renderer 恒为 human:与 ActionGroup 同规(D48 R4 口径),actor-is-human
      // 单独失败不拦截;状态类 guard 失败仍可见拒绝。
      if (guardResults[0] !== undefined && blockedForRenderer(guardResults[0])) {
        return refusal(
          input,
          'guard-blocked',
          guardResults[0].reason ?? `Action "${input.action}" is blocked by its current guard`,
          false,
        );
      }

      if (
        input.expected?.actionSchema !== undefined &&
        !sameActionSchema(input.expected.actionSchema, liveAction.fields)
      ) {
        return refusal(
          input,
          'schema-stale',
          `Action "${input.action}" schema changed after the Surface was hydrated`,
          true,
        );
      }

      const expectedDependency = input.expected?.dependency;
      if (expectedDependency !== undefined) {
        if (
          expectedDependency.subject !== input.subject ||
          dependencies.resolveDependencyVersion === undefined
        ) {
          return refusal(
            input,
            'dependency-unverifiable',
            'Surface action dependency cannot be validated for the exact subject',
            true,
            { expectedVersion: expectedDependency.version },
          );
        }
        let currentVersion: string | null;
        try {
          currentVersion = await dependencies.resolveDependencyVersion({
            subject: input.subject,
            entity,
          });
        } catch {
          currentVersion = null;
        }
        if (currentVersion !== expectedDependency.version) {
          return refusal(
            input,
            currentVersion === null ? 'dependency-unverifiable' : 'dependency-stale',
            currentVersion === null
              ? 'Surface action dependency version could not be resolved'
              : `Surface action dependency changed from "${expectedDependency.version}" to "${currentVersion}"`,
            true,
            { expectedVersion: expectedDependency.version, currentVersion },
          );
        }
      }

      const gate = createActionGate(dependencies.exec);
      gate.register(entity);
      const result = await gate.handle(clientActionOf({ ...input, subject: targetRel }));
      if (result.outcome === 'executed') {
        return {
          outcome: 'executed',
          subject: targetRel,
          action: input.action,
          entity: result.entity,
          refreshSubjects: refreshSubjectsOf(input, result.entity),
        };
      }
      if (result.outcome === 'refused') {
        return refusal(input, 'exec-refused', result.reason, false, {
          status: result.status,
          layer: result.layer,
        });
      }
      return refusal(input, 'action-undeclared', result.reason, true);
    },
  };
}
