import Ajv from 'ajv';

import type { CapabilityInputSourceRef, FieldValue, JsonValue } from '@ui4a/shared';

import { hashCanonicalAgentJson } from '../agent-definition/parse';

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const BINDING_KEYS = new Set(['schemaVersion', 'fields']);
const MAX_BINDINGS = 64;

export type CapabilityInputBindingSourceV1 =
  | { from: 'action-param'; name: string }
  | { from: 'source-field'; name: string }
  | { from: 'artifact-ref'; param: string };

export interface CapabilityInputBindingV1 {
  schemaVersion: 1;
  fields: Record<string, CapabilityInputBindingSourceV1>;
}

export interface BoundCapabilityInputV1 {
  payload: Record<string, unknown>;
  sources: Record<string, CapabilityInputSourceRef>;
  hash: `sha256:${string}`;
  byteLength: number;
}

export interface CapabilityInputLimits {
  maxFields: number;
  maxDepth: number;
  maxNodes: number;
  maxBytes: number;
}

interface BindCapabilityInputOptions {
  binding: CapabilityInputBindingV1 | unknown;
  actionParams: Record<string, unknown>;
  source: { rel: string; fields: Record<string, FieldValue> };
  artifacts: Record<string, { rel: string; value: unknown }>;
  inputSchema: Record<string, unknown>;
  limits: CapabilityInputLimits;
}

function object(value: unknown, where: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
}

function exactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, where: string): void {
  const unknown = Object.keys(value).find((key) => !keys.has(key));
  if (unknown !== undefined) throw new Error(`${where}.${unknown} is unknown`);
}

function name(value: unknown, where: string): string {
  if (typeof value !== 'string' || !FIELD_NAME.test(value)) {
    throw new Error(`${where} must be one top-level field name`);
  }
  return value;
}

function parseSource(value: unknown, where: string): CapabilityInputBindingSourceV1 {
  object(value, where);
  if (value.from === 'action-param' || value.from === 'source-field') {
    exactKeys(value, new Set(['from', 'name']), where);
    name(value.name, `${where}.name`);
  } else if (value.from === 'artifact-ref') {
    exactKeys(value, new Set(['from', 'param']), where);
    name(value.param, `${where}.param`);
  } else {
    throw new Error(`${where}.from is invalid`);
  }
  return value as unknown as CapabilityInputBindingSourceV1;
}

export function parseCapabilityInputBinding(value: unknown): CapabilityInputBindingV1 {
  const where = 'capabilityInputBinding';
  object(value, where);
  exactKeys(value, BINDING_KEYS, where);
  if (value.schemaVersion !== 1) throw new Error(`${where}.schemaVersion must be 1`);
  object(value.fields, `${where}.fields`);
  const entries = Object.entries(value.fields);
  if (entries.length === 0 || entries.length > MAX_BINDINGS) {
    throw new Error(`${where}.fields must contain 1-${MAX_BINDINGS} entries`);
  }
  const fields = Object.fromEntries(
    entries.map(([destination, source]) => [
      name(destination, `${where}.fields destination`),
      parseSource(source, `${where}.fields.${destination}`),
    ]),
  );
  return { schemaVersion: 1, fields };
}

function positiveLimit(value: number, where: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${where} must be a bounded positive integer`);
  }
  return value;
}

function assertJsonBudget(value: unknown, limits: CapabilityInputLimits): void {
  const maxDepth = positiveLimit(limits.maxDepth, 'limits.maxDepth', 64);
  const maxNodes = positiveLimit(limits.maxNodes, 'limits.maxNodes', 10_000);
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > maxNodes) throw new Error('capability input exceeds node budget');
    if (depth > maxDepth) throw new Error('capability input exceeds depth budget');
    if (
      candidate === null ||
      typeof candidate === 'string' ||
      typeof candidate === 'boolean' ||
      (typeof candidate === 'number' && Number.isFinite(candidate))
    ) {
      return;
    }
    if (typeof candidate !== 'object') throw new Error('capability input must be JSON');
    if (seen.has(candidate)) throw new Error('capability input must not be cyclic');
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
    } else {
      for (const item of Object.values(candidate as Record<string, unknown>)) {
        visit(item, depth + 1);
      }
    }
    seen.delete(candidate);
  };
  visit(value, 1);
}

function resolveSource(
  source: CapabilityInputBindingSourceV1,
  options: BindCapabilityInputOptions,
): { value: unknown; provenance: CapabilityInputSourceRef } {
  if (source.from === 'action-param') {
    if (!Object.hasOwn(options.actionParams, source.name)) {
      throw new Error(`action param ${source.name} is missing`);
    }
    return {
      value: options.actionParams[source.name],
      provenance: { from: 'action-param', name: source.name },
    };
  }
  if (source.from === 'source-field') {
    const field = options.source.fields[source.name];
    if (field === undefined) throw new Error(`source field ${source.name} is missing`);
    return {
      value: field.value,
      provenance: { from: 'source-field', name: source.name, rel: options.source.rel },
    };
  }
  const requestedRel = options.actionParams[source.param];
  const artifact = options.artifacts[source.param];
  if (typeof requestedRel !== 'string' || artifact === undefined || artifact.rel !== requestedRel) {
    throw new Error(`authorized artifact ${source.param} is unresolved`);
  }
  return {
    value: artifact.value,
    provenance: { from: 'artifact-ref', param: source.param, rel: artifact.rel },
  };
}

export function bindCapabilityInput(options: BindCapabilityInputOptions): BoundCapabilityInputV1 {
  const binding = parseCapabilityInputBinding(options.binding);
  positiveLimit(options.limits.maxFields, 'limits.maxFields', MAX_BINDINGS);
  if (Object.keys(binding.fields).length > options.limits.maxFields) {
    throw new Error('capability input exceeds field budget');
  }
  const payload: Record<string, unknown> = {};
  const sources: Record<string, CapabilityInputSourceRef> = {};
  for (const [destination, source] of Object.entries(binding.fields)) {
    const resolved = resolveSource(source, options);
    payload[destination] = resolved.value;
    sources[destination] = resolved.provenance;
  }
  assertJsonBudget(payload, options.limits);
  const canonical = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(canonical).byteLength;
  const maxBytes = positiveLimit(options.limits.maxBytes, 'limits.maxBytes', 65_536);
  if (byteLength > maxBytes) throw new Error('capability input exceeds bytes budget');

  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(options.inputSchema);
  if (!validate(payload)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ');
    throw new Error(`capability input schema rejected: ${detail}`);
  }
  return {
    payload,
    sources,
    hash: hashCanonicalAgentJson(payload as JsonValue),
    byteLength,
  };
}
