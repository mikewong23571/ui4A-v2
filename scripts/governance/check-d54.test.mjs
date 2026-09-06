import { describe, expect, it } from 'vitest';

import { checkD54, inspectCognitiveBundle, inspectRuntimeSpecialCases } from './check-d54.mjs';

describe('D54 standing governance', () => {
  it('discovers generic planners, words and action hosts through the real git pathspecs', () => {
    const result = checkD54();

    expect(result.runtimeFiles).toEqual(
      expect.arrayContaining([
        'packages/engine/src/presentation/surface/generic.ts',
        'packages/engine/src/presentation/recipe/resolver.ts',
        'apps/web/src/render/words/member-card.tsx',
        'apps/web/src/render/words/member-overview.ts',
        'apps/web/src/components/actions/action-group.tsx',
        'apps/web/src/components/actions/action-json-fields.ts',
        'apps/web/src/components/action-runner.tsx',
        'apps/web/src/engine/presentation/app-workspace/composition.ts',
      ]),
    );
    expect(result.runtimeFiles.some((file) => /\.(?:test|spec)\./.test(file))).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it.each([
    'packages/engine/src/presentation/surface/fixture.ts',
    'apps/web/src/render/words/fixture.tsx',
    'apps/web/src/components/actions/fixture.tsx',
  ])('rejects installed-name branches at the generic boundary %s', (file) => {
    const source = [
      "if (application.name === 'publishing') return specialLayout;",
      "if ('idea-item' === flow.name) return specialInput;",
      "case 'flow:software-change': return specialWord;",
      "if (rel.startsWith('post:first-post')) return specialActions;",
      "if (collections.includes('cves')) return specialCard;",
    ].join('\n');
    const violations = inspectRuntimeSpecialCases(file, source, [
      'publishing',
      'idea-item',
      'flow:software-change',
      'post:first-post',
      'cves',
    ]);

    expect(violations).toHaveLength(5);
    expect(violations.map((violation) => [violation.file, violation.line])).toEqual([
      [file, 1],
      [file, 2],
      [file, 3],
      [file, 4],
      [file, 5],
    ]);
  });

  it('preserves core rel dispatch, contract actions and cognitive or input semantics', () => {
    const source = [
      'if (rel.startsWith(THREAD_REL_PREFIX)) return threadContract;',
      "if (subject.startsWith('thread:')) return threadSubject;",
      'if (action.name === THREAD_ATTACH_ACTION.name) return materialInput;',
      "if (action['requires-confirmation'] === 'high') return confirmation;",
      "if (guard.name === 'actor-is-human') return humanGuard;",
      "if (traits.includes('review-queue')) return decisionContent;",
      "if (owner === 'client') return injectClientInput;",
      "case 'actions': return bindDeclaredActions;",
    ].join('\n');

    expect(
      inspectRuntimeSpecialCases('generic.ts', source, [
        'default',
        'publishing',
        'idea-item',
        'post:first-post',
      ]),
    ).toEqual([]);
  });

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
