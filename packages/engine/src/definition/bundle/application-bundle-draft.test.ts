import { describe, expect, it } from 'vitest';

import { APPLICATION_BUNDLE_SCHEMA } from '../meta-bootstrap';
import { bundleInventoryConflicts, validateApplicationBundleDraft } from './application-bundle-draft';

// T48 Phase 1 / T1.2:application-bundle Draft 的纯校验器单测。
// 只测适配器合同:unknown payload → DraftValidation 形状;解析细节由
// meta-bootstrap.test.ts 覆盖,此处不重复。
const artifact = {
  schema: APPLICATION_BUNDLE_SCHEMA,
  bundle: { name: 'demo-bundle', version: 1 },
  applications: [{ name: 'demo-bundle', title: 'Demo', intent: 'Demonstrate a governed bundle' }],
  capabilities: [],
  flows: [
    {
      name: 'demo-entry',
      title: 'Demo entry',
      app: 'demo-bundle',
      initial: 'start',
      nodes: [{ name: 'start', title: 'Start', fields: [], actions: [] }],
      fields: [],
    },
  ],
  seed: { rel: 'seed:demo-bundle', detail: { instances: {} } },
} as const;

describe('validateApplicationBundleDraft', () => {
  it('accepts a well-formed bundle and returns the normalized value', () => {
    const validation = validateApplicationBundleDraft(artifact);
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.value).toMatchObject({
      bundle: { name: 'demo-bundle', version: 1 },
      applications: [{ name: 'demo-bundle' }],
      flows: [{ name: 'demo-entry', app: 'demo-bundle' }],
    });
  });

  it('rejects non-object payloads with parse-error issues instead of throwing', () => {
    for (const payload of [null, undefined, 42, 'demo-bundle', [], true]) {
      const validation = validateApplicationBundleDraft(payload);
      expect(validation.valid, `payload ${String(payload)} must be invalid`).toBe(false);
      expect(validation.issues).toHaveLength(1);
      expect(validation.issues[0]).toMatchObject({ code: 'parse-error', path: '/' });
      expect(validation.value).toBeUndefined();
    }
  });

  it('rejects a schema mismatch as an issue, never a throw', () => {
    const validation = validateApplicationBundleDraft({
      ...artifact,
      schema: 'https://example.com/other/v9',
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues[0]).toMatchObject({
      code: 'parse-error',
      message: expect.stringContaining('application bundle schema'),
    });
  });

  it('rejects cross-reference violations with the parser message as evidence', () => {
    const validation = validateApplicationBundleDraft({
      ...artifact,
      flows: [{ ...artifact.flows[0], app: 'other-app' }],
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues[0]?.message).toContain('demo-entry');
    expect(validation.issues[0]?.message).toContain('other-app');
  });
});

describe('bundleInventoryConflicts', () => {
  // T48 评审修复(D66.1 fail-closed):bundle 制品可声明多个 application,
  // genesis 门禁必须校验全量清单,而非仅 target 名。
  const conflicting = validateApplicationBundleDraft({
    ...artifact,
    applications: [
      ...artifact.applications,
      { name: 'default', title: 'Conflict', intent: 'Already installed by bootstrap' },
    ],
    capabilities: [{ name: 'shared-capability', title: 'C', kind: 'transform', intent: 'I' }],
  });
  const installed = {
    applications: new Set(['default', 'development']),
    capabilities: new Set(['shared-capability']),
    flows: new Set(['unrelated-installed-flow']),
  };

  it('reports every declared name already present in the installed sets', () => {
    expect(conflicting.value).toBeDefined();
    expect(bundleInventoryConflicts(conflicting.value!, installed)).toEqual({
      applications: ['default'],
      capabilities: ['shared-capability'],
      flows: [],
    });
  });

  it('returns undefined when the inventory is fully fresh', () => {
    const fresh = validateApplicationBundleDraft(artifact);
    expect(fresh.value).toBeDefined();
    expect(bundleInventoryConflicts(fresh.value!, installed)).toBeUndefined();
  });
});
