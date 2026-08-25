import { describe, expect, it } from 'vitest';

import {
  applicationNameFromMetaRel,
  capabilityNameFromMetaRel,
  META_APPLICATION_PREFIX,
  META_CAPABILITY_PREFIX,
  metaApplicationRel,
  metaCapabilityRel,
} from './definition';

describe('application 实体 rel 规则(T10)', () => {
  it('rel 前缀为 meta/application:(与 meta/flow:、meta/activation: 同层)', () => {
    expect(META_APPLICATION_PREFIX).toBe('meta/application:');
  });

  it('metaApplicationRel → applicationNameFromMetaRel 往返', () => {
    const rel = metaApplicationRel('publishing');
    expect(rel).toBe('meta/application:publishing');
    expect(applicationNameFromMetaRel(rel)).toBe('publishing');
  });

  it('非前缀 rel → undefined', () => {
    expect(applicationNameFromMetaRel('meta/flow:post-status')).toBeUndefined();
    expect(applicationNameFromMetaRel('meta/activation:act-1')).toBeUndefined();
    expect(applicationNameFromMetaRel('articles:a1')).toBeUndefined();
  });
});

describe('capability 实体 rel 规则(T13)', () => {
  it('rel 前缀为 meta/capability:(与 meta/flow:、meta/application: 同层)', () => {
    expect(META_CAPABILITY_PREFIX).toBe('meta/capability:');
  });

  it('metaCapabilityRel → capabilityNameFromMetaRel 往返', () => {
    const rel = metaCapabilityRel('draft');
    expect(rel).toBe('meta/capability:draft');
    expect(capabilityNameFromMetaRel(rel)).toBe('draft');
  });

  it('非前缀 rel → undefined', () => {
    expect(capabilityNameFromMetaRel('meta/flow:post-status')).toBeUndefined();
    expect(capabilityNameFromMetaRel('meta/application:publishing')).toBeUndefined();
    expect(capabilityNameFromMetaRel('articles:a1')).toBeUndefined();
  });
});
