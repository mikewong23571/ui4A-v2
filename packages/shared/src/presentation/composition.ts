import { MAX_DATA_LENS_SELECTORS } from './presentation';

/** Closed invalidation behavior for one Composition source. */
export const COMPOSITION_MODES = ['rehydrate', 'invalidate'] as const;

export const MAX_COMPOSITION_ID_LENGTH = 64;
export const MAX_COMPOSITION_REGIONS = MAX_DATA_LENS_SELECTORS;
export const MAX_COMPOSITION_VERSION_LENGTH = 256;
export const MAX_COMPOSITION_SOURCE_LENGTH = 256;
export const MAX_COMPOSITION_INTENT_LENGTH = 256;

export type CompositionMode = (typeof COMPOSITION_MODES)[number];

/** Declared presentation density for one region's member vocabulary; 'card' is the default. */
export const COMPOSITION_REGION_DENSITIES = ['card', 'table'] as const;

export type CompositionRegionDensity = (typeof COMPOSITION_REGION_DENSITIES)[number];

/** Declared contract shape of one region source; the live entity class stays authoritative. */
export type CompositionRegionShape = 'entity' | 'collection';

export interface CompositionRegionDeclaration {
  region: string;
  source: string;
  intent: string;
  mode: CompositionMode;
  shape?: CompositionRegionShape;
  density?: CompositionRegionDensity;
}

/** Platform-neutral data consumed by Composition planners and runtime registries. */
export interface CompositionDeclaration {
  id: string;
  version: string;
  regions: CompositionRegionDeclaration[];
}

/** Grammar shared by composition ids, region names and Recipe slot names. */
export const compositionRegionIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;

/** Validate one region id against the single shared bounded identifier grammar. */
export function isCompositionRegionId(value: string): boolean {
  return value.length <= MAX_COMPOSITION_ID_LENGTH && compositionRegionIdPattern.test(value);
}

const contractRelPattern = /^[a-z0-9][a-z0-9._@/-]*(?::[a-z0-9][a-z0-9._@/-]*)?$/u;
const forbiddenSourceSchemes = /^(?:data|file|https?|javascript|mailto):/u;

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
  if (unexpected !== undefined) {
    throw new Error(`${label} contains unknown key "${unexpected}"`);
  }
}

function boundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.length > maximum) {
    throw new Error(`${label} exceeds ${maximum} characters`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  const parsed = boundedText(value, MAX_COMPOSITION_ID_LENGTH, label);
  if (!isCompositionRegionId(parsed)) {
    throw new Error(`${label} must match [a-z0-9][a-z0-9._-]*`);
  }
  return parsed;
}

/** Parse an id using the exact grammar shared by declarations and workspace adapters. */
export function parseCompositionId(value: unknown): string {
  return identifier(value, 'Composition declaration id');
}

function sourceRel(value: unknown, label: string): string {
  const parsed = boundedText(value, MAX_COMPOSITION_SOURCE_LENGTH, label);
  if (parsed.startsWith('workspace:')) {
    throw new Error(`${label} cannot use the workspace virtual subject namespace`);
  }
  if (forbiddenSourceSchemes.test(parsed) || !contractRelPattern.test(parsed)) {
    throw new Error(`${label} must be a safe contract rel`);
  }
  return parsed;
}

function mode(value: unknown, label: string): CompositionMode {
  if (!COMPOSITION_MODES.includes(value as CompositionMode)) {
    throw new Error(`${label} must be rehydrate or invalidate`);
  }
  return value as CompositionMode;
}

function shape(value: unknown, label: string): CompositionRegionShape | undefined {
  if (value === undefined) return undefined;
  if (value !== 'entity' && value !== 'collection') {
    throw new Error(`${label} must be entity or collection`);
  }
  return value;
}

function density(value: unknown, label: string): CompositionRegionDensity | undefined {
  if (value === undefined) return undefined;
  if (!COMPOSITION_REGION_DENSITIES.includes(value as CompositionRegionDensity)) {
    throw new Error(`${label} must be card or table`);
  }
  return value as CompositionRegionDensity;
}

function region(value: unknown, index: number): CompositionRegionDeclaration {
  const label = `Composition region[${index}]`;
  record(value, label);
  exactKeys(value, ['region', 'source', 'intent', 'mode', 'shape', 'density'], label);
  return {
    region: identifier(value.region, `${label} region`),
    source: sourceRel(value.source, `${label} source rel`),
    intent: boundedText(value.intent, MAX_COMPOSITION_INTENT_LENGTH, `${label} intent`),
    mode: mode(value.mode, `${label} mode`),
    ...(value.shape === undefined ? {} : { shape: shape(value.shape, `${label} shape`) }),
    ...(value.density === undefined ? {} : { density: density(value.density, `${label} density`) }),
  };
}

/** Strictly parse one bounded declaration; the declaration itself grants no source access. */
export function parseCompositionDeclaration(value: unknown): CompositionDeclaration {
  record(value, 'Composition declaration');
  exactKeys(value, ['id', 'version', 'regions'], 'Composition declaration');
  if (
    !Array.isArray(value.regions) ||
    value.regions.length === 0 ||
    value.regions.length > MAX_COMPOSITION_REGIONS
  ) {
    throw new Error(
      `Composition declaration regions must contain 1-${MAX_COMPOSITION_REGIONS} entries`,
    );
  }

  const regions = value.regions.map(region);
  if (new Set(regions.map((entry) => entry.region)).size !== regions.length) {
    throw new Error('Composition declaration region names must be unique');
  }

  return {
    id: parseCompositionId(value.id),
    version: boundedText(
      value.version,
      MAX_COMPOSITION_VERSION_LENGTH,
      'Composition declaration version',
    ),
    regions,
  };
}
