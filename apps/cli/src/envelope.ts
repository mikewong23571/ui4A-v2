export const CLI_SCHEMA_VERSION = 1 as const;
export const CLI_VERSION = '0.1.0';

export interface PageEnvelope {
  nextCursor: string | number | null;
  hasMore?: boolean;
}

export interface SuccessEnvelope {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  ok: true;
  command: string;
  data: unknown;
  page?: PageEnvelope;
  meta: { cliVersion: string; protocolVersion?: string; requestId: string };
}

export interface ErrorEnvelope {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  ok: false;
  command: string;
  error: {
    code: string;
    message: string;
    status?: number;
    details?: unknown;
    retryable: boolean;
    requestId: string;
  };
  meta: { cliVersion: string };
}

let requestCounter = 0;

export function requestId(): string {
  requestCounter += 1;
  return `cli-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

export function success(
  command: string,
  data: unknown,
  options?: { protocolVersion?: string; page?: PageEnvelope; requestId?: string },
): SuccessEnvelope {
  return {
    schemaVersion: CLI_SCHEMA_VERSION,
    ok: true,
    command,
    data,
    ...(options?.page === undefined ? {} : { page: options.page }),
    meta: {
      cliVersion: CLI_VERSION,
      ...(options?.protocolVersion === undefined
        ? {}
        : { protocolVersion: options.protocolVersion }),
      requestId: options?.requestId ?? requestId(),
    },
  };
}

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode: number,
    readonly status?: number,
    readonly details?: unknown,
    readonly retryable = false,
    readonly id = requestId(),
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export function failure(command: string, error: CliError): ErrorEnvelope {
  return {
    schemaVersion: CLI_SCHEMA_VERSION,
    ok: false,
    command,
    error: {
      code: error.code,
      message: error.message,
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.details === undefined ? {} : { details: error.details }),
      retryable: error.retryable,
      requestId: error.id,
    },
    meta: { cliVersion: CLI_VERSION },
  };
}

const SENSITIVE = /token|authorization|cookie|api[-_]?key|secret/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      SENSITIVE.test(key) ? '[REDACTED]' : redact(child),
    ]),
  );
}
