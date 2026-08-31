import type { SirenEntity } from '@ui4a/engine';

import { sanitizeProperties } from '../contract/cognition';
import type { WorkingContext } from './working-context';

export const WORKING_CONTEXT_PROMPT_BYTES = 6 * 1024;
const PROPERTY_BYTES = 1024;

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function cognition(entity: SirenEntity, root: boolean) {
  const candidates = sanitizeProperties(entity.properties, !root);
  delete candidates.presentation;
  // The work-thread protocol carries an explicit, sourced goal, never inferred from its members.
  if (root && typeof entity.properties.goal === 'object' && entity.properties.goal !== null) {
    const goal = entity.properties.goal as Record<string, unknown>;
    candidates.goal = {
      ...(typeof goal.text === 'string' ? { text: goal.text } : {}),
      ...(typeof goal.source === 'string' ? { source: goal.source } : {}),
    };
  }
  const properties: Record<string, unknown> = {};
  let omittedProperties = 0;
  for (const [key, value] of Object.entries(candidates)) {
    if (bytes({ ...properties, [key]: value }) <= PROPERTY_BYTES) properties[key] = value;
    else omittedProperties += 1;
  }
  return { properties, ...(omittedProperties === 0 ? {} : { omittedProperties }) };
}

/** Bounded source-preserving cognition; omitted values are never truncated into invented facts. */
export function describeWorkingContext(context: WorkingContext): string {
  const root = context.entity === undefined ? undefined : cognition(context.entity, true);
  const references = context.references.map((reference) => {
    const observation = context.observations.find(({ rel }) => rel === reference.rel);
    return {
      ...reference,
      ...(observation === undefined
        ? { unavailable: true }
        : { entity: cognition(observation.entity, false) }),
    };
  });
  const projection = {
    rel: context.rel,
    unavailable: context.unavailable,
    ...(root === undefined ? {} : { entity: root }),
    references,
    truncated: context.truncated,
  };
  while (bytes(projection) > WORKING_CONTEXT_PROMPT_BYTES && references.length > 0) {
    references.pop();
    projection.truncated += 1;
  }
  if (bytes(projection) > WORKING_CONTEXT_PROMPT_BYTES) {
    return JSON.stringify({ contentOmitted: true, unavailable: context.unavailable });
  }
  return JSON.stringify(projection);
}

/** Additional navigation is reference-only; related entity actions never become tools. */
export function workingContextRels(context: WorkingContext | undefined): string[] {
  if (context === undefined || context.unavailable) return [];
  return [context.rel, ...context.references.map(({ rel }) => rel)];
}
