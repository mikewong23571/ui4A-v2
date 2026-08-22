/** Version of the thin Chat/runtime to Presentation Plane protocol. */
export const PRESENTATION_PROTOCOL_VERSION = 1 as const;

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
