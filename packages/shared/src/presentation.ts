/** Version of the thin Chat/runtime to Presentation Plane protocol. */
export const PRESENTATION_PROTOCOL_VERSION = 1 as const;

/** Version and hard safety ceilings for the serialized Situation passed to Presentation. */
export const PRESENTATION_SITUATION_VERSION = 1 as const;
export const MAX_RENDER_SITUATION_DEPTH = 8;
export const MAX_RENDER_SITUATION_NODES = 256;
export const MAX_DATA_LENS_SELECTORS = 32;

export type PresentationDelivery = 'inline' | 'canvas' | 'auto';
export type PresentationReceiptStatus = 'ready' | 'pending' | 'fallback' | 'failed';

/**
 * Presentation starts from one contract rel. Selection and graph traversal remain an intent for the
 * Broker to turn into a bounded, reauthorized Situation; this string grants no access by itself.
 */
export type RenderSubject = string;

/** Natural-language/user preference hint. Complex planning data belongs in Presentation. */
export type RenderConstraint = string;

/**
 * The only presentation shape a model may propose. Runtime-controlled identity, principal and
 * message provenance are deliberately absent and are added by completePresentationRequest().
 */
export interface PresentationIntent {
  subject: RenderSubject;
  intent: string;
  constraints?: RenderConstraint[];
  delivery: PresentationDelivery;
}

/** Shared by Chat, direct navigation and Flow transitions. An empty source list means no Chat. */
export interface PresentationRequest extends PresentationIntent {
  schemaVersion: typeof PRESENTATION_PROTOCOL_VERSION;
  requestId: string;
  principal: string;
  sourceMessageIds: string[];
}

export interface PresentationSidecarRef {
  id: string;
  version: number;
}

export interface PresentationReceipt {
  schemaVersion: typeof PRESENTATION_PROTOCOL_VERSION;
  requestId: string;
  status: PresentationReceiptStatus;
  sidecar?: PresentationSidecarRef;
  surfaceUrl?: string;
  reasonCode?: string;
}

export interface TrustedPresentationRequestContext {
  requestId: string;
  principal: string;
  sourceMessageIds: string[];
}

export interface PresentationEntityRef {
  rel: string;
}

export type FlowLensRegion = 'current-node' | 'context' | 'outputs' | 'history';

/**
 * A deliberately closed navigation vocabulary. Roots carry explicit selection; relations are
 * names from the already-authorized Siren contract, never predicates or an arbitrary query.
 */
export type DataLens =
  | { kind: 'self' }
  | { kind: 'members' }
  | { kind: 'selection' }
  | { kind: 'relations'; relations: string[] }
  | { kind: 'flow'; include: FlowLensRegion[] }
  | { kind: 'graph'; relations: string[] };

export interface RenderAudience {
  principal: string;
  policyScope: string;
  role?: string;
  deviceClass?: string;
}

export interface RenderBudget {
  maxDepth: number;
  maxNodes: number;
}

/** Serializable, authorization-neutral input to bounded Presentation graph construction. */
export interface RenderSituation {
  schemaVersion: typeof PRESENTATION_SITUATION_VERSION;
  roots: PresentationEntityRef[];
  intent: string;
  lens: DataLens;
  audience: RenderAudience;
  budget: RenderBudget;
}

const FORBIDDEN_PROTOCOL_KEYS = new Set([
  'surface',
  'component',
  'bind',
  'dependency',
  'sessionId',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_PROTOCOL_KEYS.has(key)) {
      throw new Error(`${label} contains forbidden key "${key}"`);
    }
    if (!allowed.has(key)) throw new Error(`${label} contains unknown key "${key}"`);
  }
}

const SESSION_IDENTIFIER_KEYS = new Set(['session', 'sessionid', 'sessionkey']);

function assertNoSessionIdentifiers(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoSessionIdentifiers(entry, label);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replaceAll(/[-_]/g, '');
    if (SESSION_IDENTIFIER_KEYS.has(normalizedKey)) {
      throw new Error(`${label} contains forbidden session identifier "${key}"`);
    }
    assertNoSessionIdentifiers(entry, label);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, label: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  return value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
}

function boundedUniqueStringArray(value: unknown, label: string): string[] {
  const entries = stringArray(value, label, false);
  if (entries.length > MAX_DATA_LENS_SELECTORS) {
    throw new Error(`${label} exceeds ${MAX_DATA_LENS_SELECTORS} selectors`);
  }
  if (new Set(entries).size !== entries.length) {
    throw new Error(`${label} entries must be unique`);
  }
  return entries;
}

function boundedPositiveInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return value as number;
}

/** Parse one closed Data Lens variant. The result contains no executable/query expression. */
export function parseDataLens(value: unknown): DataLens {
  assertNoSessionIdentifiers(value, 'Data lens');
  assertRecord(value, 'Data lens');
  const kind = value.kind;
  switch (kind) {
    case 'self':
    case 'members':
    case 'selection':
      assertExactKeys(value, ['kind'], 'Data lens');
      return { kind };
    case 'relations':
    case 'graph': {
      assertExactKeys(value, ['kind', 'relations'], 'Data lens');
      return { kind, relations: boundedUniqueStringArray(value.relations, 'Data lens relations') };
    }
    case 'flow': {
      assertExactKeys(value, ['kind', 'include'], 'Data lens');
      if (!Array.isArray(value.include) || value.include.length === 0) {
        throw new Error('Data lens flow include must be a non-empty array');
      }
      const allowed = new Set<FlowLensRegion>(['current-node', 'context', 'outputs', 'history']);
      const include = value.include.map((entry, index) => {
        if (typeof entry !== 'string' || !allowed.has(entry as FlowLensRegion)) {
          throw new Error(`Data lens flow include[${index}] is invalid`);
        }
        return entry as FlowLensRegion;
      });
      if (new Set(include).size !== include.length) {
        throw new Error('Data lens flow include entries must be unique');
      }
      return { kind, include };
    }
    default:
      throw new Error(`Data lens kind "${String(kind)}" is invalid`);
  }
}

/** Strictly parse the versioned, bounded Situation accepted by Presentation graph builders. */
export function parseRenderSituation(value: unknown): RenderSituation {
  assertNoSessionIdentifiers(value, 'Render situation');
  assertRecord(value, 'Render situation');
  assertExactKeys(
    value,
    ['schemaVersion', 'roots', 'intent', 'lens', 'audience', 'budget'],
    'Render situation',
  );
  if (value.schemaVersion !== PRESENTATION_SITUATION_VERSION) {
    throw new Error(`Unsupported Render situation version "${String(value.schemaVersion)}"`);
  }

  if (!Array.isArray(value.roots) || value.roots.length === 0) {
    throw new Error('Render situation roots must be a non-empty array');
  }
  const roots = value.roots.map((root, index): PresentationEntityRef => {
    assertRecord(root, `Render situation roots[${index}]`);
    assertExactKeys(root, ['rel'], `Render situation roots[${index}]`);
    return { rel: requiredString(root.rel, `Render situation roots[${index}].rel`) };
  });
  if (new Set(roots.map((root) => root.rel)).size !== roots.length) {
    throw new Error('Render situation roots must be unique');
  }

  assertRecord(value.audience, 'Render situation audience');
  assertExactKeys(
    value.audience,
    ['principal', 'policyScope', 'role', 'deviceClass'],
    'Render situation audience',
  );
  const audience: RenderAudience = {
    principal: requiredString(value.audience.principal, 'Render situation audience principal'),
    policyScope: requiredString(
      value.audience.policyScope,
      'Render situation audience policyScope',
    ),
    ...(value.audience.role === undefined
      ? {}
      : { role: requiredString(value.audience.role, 'Render situation audience role') }),
    ...(value.audience.deviceClass === undefined
      ? {}
      : {
          deviceClass: requiredString(
            value.audience.deviceClass,
            'Render situation audience deviceClass',
          ),
        }),
  };

  assertRecord(value.budget, 'Render situation budget');
  assertExactKeys(value.budget, ['maxDepth', 'maxNodes'], 'Render situation budget');
  const budget: RenderBudget = {
    maxDepth: boundedPositiveInteger(
      value.budget.maxDepth,
      MAX_RENDER_SITUATION_DEPTH,
      'Render situation budget maxDepth',
    ),
    maxNodes: boundedPositiveInteger(
      value.budget.maxNodes,
      MAX_RENDER_SITUATION_NODES,
      'Render situation budget maxNodes',
    ),
  };
  if (roots.length > budget.maxNodes) {
    throw new Error('Render situation roots exceed budget maxNodes');
  }

  return {
    schemaVersion: PRESENTATION_SITUATION_VERSION,
    roots,
    intent: requiredString(value.intent, 'Render situation intent'),
    lens: parseDataLens(value.lens),
    audience,
    budget,
  };
}

function parseConstraints(value: unknown): RenderConstraint[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('Presentation constraints must be an array');
  return value.map((entry, index) => requiredString(entry, `Presentation constraint[${index}]`));
}

function parseIntentRecord(value: Record<string, unknown>): PresentationIntent {
  const delivery = value.delivery;
  if (delivery !== 'inline' && delivery !== 'canvas' && delivery !== 'auto') {
    throw new Error('Presentation delivery must be inline, canvas or auto');
  }
  const constraints = parseConstraints(value.constraints);
  return {
    subject: requiredString(value.subject, 'Presentation subject'),
    intent: requiredString(value.intent, 'Presentation intent'),
    ...(constraints === undefined ? {} : { constraints }),
    delivery,
  };
}

/** Parse a model-proposed thin intent and reject all runtime-controlled or planning payloads. */
export function parsePresentationIntent(value: unknown): PresentationIntent {
  assertRecord(value, 'Presentation intent');
  assertExactKeys(value, ['subject', 'intent', 'constraints', 'delivery'], 'Presentation intent');
  return parseIntentRecord(value);
}

/** Parse the complete wire request used by every Presentation Broker origin. */
export function parsePresentationRequest(value: unknown): PresentationRequest {
  assertRecord(value, 'Presentation request');
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'requestId',
      'principal',
      'subject',
      'intent',
      'constraints',
      'delivery',
      'sourceMessageIds',
    ],
    'Presentation request',
  );
  if (value.schemaVersion !== PRESENTATION_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Presentation protocol version "${String(value.schemaVersion)}"`);
  }
  return {
    schemaVersion: PRESENTATION_PROTOCOL_VERSION,
    requestId: requiredString(value.requestId, 'Presentation requestId'),
    principal: requiredString(value.principal, 'Presentation principal'),
    ...parseIntentRecord(value),
    sourceMessageIds: stringArray(value.sourceMessageIds, 'Presentation sourceMessageIds', true),
  };
}

/**
 * Complete an untrusted model/runtime intent with identity and authorization provenance supplied by
 * the trusted caller. The function copies fields explicitly instead of spreading model output.
 */
export function completePresentationRequest(
  intent: PresentationIntent,
  trusted: TrustedPresentationRequestContext,
): PresentationRequest {
  const parsedIntent = parsePresentationIntent(intent);
  return parsePresentationRequest({
    schemaVersion: PRESENTATION_PROTOCOL_VERSION,
    requestId: trusted.requestId,
    principal: trusted.principal,
    subject: parsedIntent.subject,
    intent: parsedIntent.intent,
    ...(parsedIntent.constraints === undefined ? {} : { constraints: parsedIntent.constraints }),
    delivery: parsedIntent.delivery,
    sourceMessageIds: trusted.sourceMessageIds,
  });
}

/** Parse the compact Presentation Plane result retained by Chat/runtime callers. */
export function parsePresentationReceipt(value: unknown): PresentationReceipt {
  assertRecord(value, 'Presentation receipt');
  assertExactKeys(
    value,
    ['schemaVersion', 'requestId', 'status', 'sidecar', 'surfaceUrl', 'reasonCode'],
    'Presentation receipt',
  );
  if (value.schemaVersion !== PRESENTATION_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Presentation protocol version "${String(value.schemaVersion)}"`);
  }
  const status = value.status;
  if (status !== 'ready' && status !== 'pending' && status !== 'fallback' && status !== 'failed') {
    throw new Error('Presentation receipt status is invalid');
  }

  let sidecar: PresentationSidecarRef | undefined;
  if (value.sidecar !== undefined) {
    assertRecord(value.sidecar, 'Presentation sidecar reference');
    assertExactKeys(value.sidecar, ['id', 'version'], 'Presentation sidecar reference');
    if (!Number.isInteger(value.sidecar.version) || (value.sidecar.version as number) < 1) {
      throw new Error('Presentation sidecar version must be a positive integer');
    }
    sidecar = {
      id: requiredString(value.sidecar.id, 'Presentation sidecar id'),
      version: value.sidecar.version as number,
    };
  }

  return {
    schemaVersion: PRESENTATION_PROTOCOL_VERSION,
    requestId: requiredString(value.requestId, 'Presentation receipt requestId'),
    status,
    ...(sidecar === undefined ? {} : { sidecar }),
    ...(value.surfaceUrl === undefined
      ? {}
      : { surfaceUrl: requiredString(value.surfaceUrl, 'Presentation surfaceUrl') }),
    ...(value.reasonCode === undefined
      ? {}
      : { reasonCode: requiredString(value.reasonCode, 'Presentation reasonCode') }),
  };
}
