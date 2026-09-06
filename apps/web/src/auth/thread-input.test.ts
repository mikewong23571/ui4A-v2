import { describe, expect, it } from 'vitest';
import { executeThreadCommand, project, type SirenEntity, type Sitemap } from '@ui4a/engine';
import { seedGuardRegistry, type EngineSnapshot } from '@ui4a/shared';
import {
  assertThreadOwner,
  filterThreadEntityForPrincipal,
  filterEntityForGrantedApplications,
} from './application-scope';

const empty: EngineSnapshot = { instances: {}, collections: {} };
const created = executeThreadCommand(
  {
    rel: 'threads',
    action: 'create',
    principal: 'owner',
    params: { commandId: 'original', goal: 'PRIVATE INPUT' },
  },
  empty,
);
if (created.kind !== 'accepted') throw new Error('fixture failed');
const snapshot = created.snapshot;
const deps = { flows: {}, guards: seedGuardRegistry };
const sitemap = {
  surfaces: [],
  flows: [],
  applications: [],
  capabilities: [],
  version: 'test',
} as Sitemap;

describe('thread input source ownership', () => {
  it('enforces the same owner gate for source and thread without requiring application credentials', () => {
    for (const rel of ['thread:original', 'thread-input:original']) {
      expect(() => assertThreadOwner(snapshot, rel, 'owner')).not.toThrow();
      expect(() => assertThreadOwner(snapshot, rel, 'other')).toThrow();
    }
  });
  it('redacts foreign source links and embedded source text in both local and credential projections', () => {
    const source = project(snapshot, 'thread-input:original', deps)!;
    const wrapper: SirenEntity = {
      class: ['collection'],
      properties: { count: 1 },
      actions: [],
      links: [{ rel: ['source'], href: '/api/entity?rel=thread-input:original' }],
      entities: [source],
    };
    const local = filterThreadEntityForPrincipal(wrapper, snapshot, 'materials', 'other');
    const credential = filterEntityForGrantedApplications(wrapper, {
      snapshot,
      sitemap,
      plane: 'business',
      principal: 'other',
      grantedApplications: [],
    });
    for (const entity of [local, credential]) {
      expect(entity.entities).toEqual([]);
      expect(entity.links).toEqual([]);
      expect(JSON.stringify(entity)).not.toContain('PRIVATE INPUT');
    }
  });
});
