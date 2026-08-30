import type { SemanticRegionRole, SirenEntity } from '@ui4a/engine';

import { APP_WORKSPACE_HEADER_REGION } from './composition';

export function isApplicationHeaderRegion(region: string): boolean {
  return region === APP_WORKSPACE_HEADER_REGION;
}

/** Limit the header planner to the Application facts that the landing is allowed to bind. */
export function applicationHeaderPlanningEntity(entity: SirenEntity): SirenEntity {
  return {
    ...entity,
    properties: Object.fromEntries(
      ['rel', 'title', 'intent', 'entry', 'presentation'].flatMap((key) =>
        key in entity.properties ? [[key, entity.properties[key]] as const] : [],
      ),
    ),
  };
}

export function applicationHeaderSemanticHints(): Record<string, SemanticRegionRole> {
  return {
    'properties.title': 'identity',
    'properties.intent': 'primary-content',
    'properties.entry.target': 'relation',
    'properties.entry.role': 'metadata',
    'properties.presentation.traits': 'metadata',
  };
}
