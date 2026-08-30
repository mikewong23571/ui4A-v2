import { describe, expect, it } from 'vitest';

import { contentVersion } from '../sitemap';
import {
  metaMemberPresentation,
  metaTopLevelPresentation,
  withMetaTopLevelPresentation,
} from './meta-presentation';

describe('Meta contract presentation declarations', () => {
  it('projects the closed top-level cognition vocabulary and leaves unknown surfaces honest', () => {
    expect(metaTopLevelPresentation('meta/activations')).toEqual({
      version: 1,
      traits: ['human-responsibility', 'review-queue'],
      groupRole: 'responsibility',
      priority: 'high',
      emptyMeaning: 'no-current-responsibility',
    });
    expect(metaTopLevelPresentation('meta/drafts')).toMatchObject({
      groupRole: 'candidate',
      priority: 'high',
    });
    expect(metaTopLevelPresentation('meta/applications')).toMatchObject({
      groupRole: 'definition',
      priority: 'normal',
    });
    expect(metaTopLevelPresentation('meta/self')).toMatchObject({
      groupRole: 'system',
      priority: 'low',
    });
    expect(withMetaTopLevelPresentation({ rel: 'meta/future', title: 'Future' })).toEqual({
      rel: 'meta/future',
      title: 'Future',
    });
  });

  it('uses the existing field-presentation wire for embedded summary overview order', () => {
    expect(metaMemberPresentation('application').fields?.map((field) => field.path)).toEqual([
      'properties.title',
      'properties.intent',
      'properties.version',
      'properties.flowCount',
      'properties.capabilityCount',
      'properties.policyCount',
    ]);
    expect(metaMemberPresentation('activation').fields?.map((field) => field.role)).toEqual([
      'identity',
      'status',
      'metadata',
    ]);
  });

  it('makes presentation part of the surface content fingerprint', () => {
    const bare = [{ rel: 'meta/activations', title: '激活队列', collection: true }];
    const declared = bare.map(withMetaTopLevelPresentation);
    expect(contentVersion(declared)).not.toBe(contentVersion(bare));
  });
});
