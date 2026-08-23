import { parseRenderSubject, type RenderSubject } from './presentation';

export const CHAT_VIEW_PROTOCOL_VERSION = 1 as const;
export const MAX_CLIENT_INSTANCE_ID_LENGTH = 128;
export const MAX_CLIENT_ROUTE_LENGTH = 2_048;
export const MAX_CHAT_VIEW_ID_LENGTH = 256;
export const MAX_CHAT_VIEW_REL_LENGTH = 512;

export interface ClientViewReport {
  schemaVersion: typeof CHAT_VIEW_PROTOCOL_VERSION;
  clientInstanceId: string;
  route: string;
  subject?: RenderSubject;
  presentationRequestId?: string;
}

export interface ClientViewFact extends ClientViewReport {
  sourceMessageId: string;
  observedAtSeq: number;
}

export type NavigationCompletionSource = 'agent-navigate' | 'presentation-receipt';

export interface NavigationCompletion {
  schemaVersion: typeof CHAT_VIEW_PROTOCOL_VERSION;
  navigationId: string;
  source: NavigationCompletionSource;
  sessionId: string;
  turnId: string;
  subject: RenderSubject;
  route: string;
  sourceMessageIds: string[];
  step?: number;
  presentationRequestId?: string;
}

export interface LastNavigationFact extends NavigationCompletion {
  completedAtSeq: number;
}

function record(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) throw new Error(`${label} contains forbidden key ${unexpected}`);
}

function boundedString(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string within ${max} characters`);
  }
  return value;
}

function parseRoute(value: unknown): string {
  const route = boundedString(value, MAX_CLIENT_ROUTE_LENGTH, 'Client view route');
  if (
    !route.startsWith('/') ||
    route.startsWith('//') ||
    route.includes('#') ||
    route.includes('\\') ||
    /[\r\n]/.test(route)
  ) {
    throw new Error('Client view route must be a same-origin pathname and search string');
  }
  return route;
}

function boundedSubject(value: unknown): RenderSubject {
  const subject = parseRenderSubject(value);
  const rels = typeof subject === 'string' ? [subject] : subject.selection;
  if (rels.some((rel) => rel.length > MAX_CHAT_VIEW_REL_LENGTH)) {
    throw new Error(`Client view subject exceeds ${MAX_CHAT_VIEW_REL_LENGTH} characters`);
  }
  return subject;
}

function parseSchemaVersion(value: unknown, label: string): typeof CHAT_VIEW_PROTOCOL_VERSION {
  if (value !== CHAT_VIEW_PROTOCOL_VERSION) {
    throw new Error(`${label} schemaVersion must be ${CHAT_VIEW_PROTOCOL_VERSION}`);
  }
  return CHAT_VIEW_PROTOCOL_VERSION;
}

export function parseClientViewReport(value: unknown): ClientViewReport {
  record(value, 'Client view report');
  exactKeys(
    value,
    ['schemaVersion', 'clientInstanceId', 'route', 'subject', 'presentationRequestId'],
    'Client view report',
  );
  const subject = value.subject === undefined ? undefined : boundedSubject(value.subject);
  const presentationRequestId =
    value.presentationRequestId === undefined
      ? undefined
      : boundedString(
          value.presentationRequestId,
          MAX_CHAT_VIEW_ID_LENGTH,
          'Client view presentationRequestId',
        );
  return {
    schemaVersion: parseSchemaVersion(value.schemaVersion, 'Client view report'),
    clientInstanceId: boundedString(
      value.clientInstanceId,
      MAX_CLIENT_INSTANCE_ID_LENGTH,
      'Client view clientInstanceId',
    ),
    route: parseRoute(value.route),
    ...(subject === undefined ? {} : { subject }),
    ...(presentationRequestId === undefined ? {} : { presentationRequestId }),
  };
}

function sourceMessageIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new Error('Navigation completion sourceMessageIds must contain 1..32 ids');
  }
  const ids = value.map((entry) =>
    boundedString(entry, MAX_CHAT_VIEW_ID_LENGTH, 'Navigation completion sourceMessageId'),
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error('Navigation completion sourceMessageIds contains duplicate ids');
  }
  return ids;
}

export function parseNavigationCompletion(value: unknown): NavigationCompletion {
  record(value, 'Navigation completion');
  exactKeys(
    value,
    [
      'schemaVersion',
      'navigationId',
      'source',
      'sessionId',
      'turnId',
      'subject',
      'route',
      'sourceMessageIds',
      'step',
      'presentationRequestId',
    ],
    'Navigation completion',
  );
  if (value.source !== 'agent-navigate' && value.source !== 'presentation-receipt') {
    throw new Error('Navigation completion source must be agent-navigate or presentation-receipt');
  }
  if (
    value.step !== undefined &&
    (!Number.isSafeInteger(value.step) || (value.step as number) < 1)
  ) {
    throw new Error('Navigation completion step must be a positive integer');
  }
  const presentationRequestId =
    value.presentationRequestId === undefined
      ? undefined
      : boundedString(
          value.presentationRequestId,
          MAX_CHAT_VIEW_ID_LENGTH,
          'Navigation completion presentationRequestId',
        );
  if (value.source === 'agent-navigate' && value.step === undefined) {
    throw new Error('agent-navigate completion requires step');
  }
  if (value.source === 'presentation-receipt' && presentationRequestId === undefined) {
    throw new Error('presentation-receipt completion requires presentationRequestId');
  }
  return {
    schemaVersion: parseSchemaVersion(value.schemaVersion, 'Navigation completion'),
    navigationId: boundedString(
      value.navigationId,
      MAX_CHAT_VIEW_ID_LENGTH,
      'Navigation completion navigationId',
    ),
    source: value.source,
    sessionId: boundedString(
      value.sessionId,
      MAX_CHAT_VIEW_ID_LENGTH,
      'Navigation completion sessionId',
    ),
    turnId: boundedString(value.turnId, MAX_CHAT_VIEW_ID_LENGTH, 'Navigation completion turnId'),
    subject: boundedSubject(value.subject),
    route: parseRoute(value.route),
    sourceMessageIds: sourceMessageIds(value.sourceMessageIds),
    ...(value.step === undefined ? {} : { step: value.step as number }),
    ...(presentationRequestId === undefined ? {} : { presentationRequestId }),
  };
}
