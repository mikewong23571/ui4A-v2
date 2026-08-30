import { describe, expect, it } from 'vitest';

import { inspectCognitiveBundle, inspectRuntimeSpecialCases } from './check-d54.mjs';

describe('D54 standing governance', () => {
  it('rejects visual and unknown keys only from definition cognitive objects', () => {
    const bundle = {
      applications: [
        { name: 'valid', cognitive: { version: 1, traits: ['review-queue'] } },
        { name: 'layout-leak', cognitive: { version: 1, layout: 'table' } },
      ],
      flows: [{ name: 'unknown-leak', cognitive: { version: 1, futureVisualPosture: 'dense' } }],
      seed: { detail: { cognitive: { layout: 'business fact, not a definition' } } },
    };

    expect(inspectCognitiveBundle('fixture.bundle.json', bundle)).toEqual([
      {
        file: 'fixture.bundle.json',
        pattern: 'applications[1].cognitive.layout',
        reason: 'cognitive declaration key is outside the D54 closed semantic vocabulary',
      },
      {
        file: 'fixture.bundle.json',
        pattern: 'flows[0].cognitive.futureVisualPosture',
        reason: 'cognitive declaration key is outside the D54 closed semantic vocabulary',
      },
    ]);
  });

  it('detects installed application and rel literals only when they drive runtime branches', () => {
    const source = [
      "const explanatoryData = { application: 'publishing', rel: 'articles' };",
      "if (application.name === 'publishing') return specialCase;",
      "case 'articles': return specialRenderer;",
      "// if (application.name === 'community') this comment is not executable",
    ].join('\n');

    expect(
      inspectRuntimeSpecialCases('fixture.ts', source, ['publishing', 'community', 'articles']),
    ).toEqual([
      {
        file: 'fixture.ts',
        line: 2,
        pattern: "comparison with installed literal 'publishing'",
        reason: 'generic runtime must branch on contract semantics, not installed names or rels',
      },
      {
        file: 'fixture.ts',
        line: 3,
        pattern: "switch case for installed literal 'articles'",
        reason: 'generic runtime must branch on contract semantics, not installed names or rels',
      },
    ]);
  });
});
