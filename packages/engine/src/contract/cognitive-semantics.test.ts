import { describe, expect, it } from 'vitest';

import * as engine from '../index';

interface FieldPresentation {
  path: string;
  title: string;
  role?: string;
  overview?: boolean;
  contentMediaType?: string;
}

interface CognitiveSemanticsProjection {
  version: 1;
  traits?: string[];
  groupRole?: string;
  priority?: string;
  emptyMeaning?: string;
  fields?: FieldPresentation[];
}

type ProjectCognitiveSemantics = (input: {
  declaration?: unknown;
  fieldPresentations?: readonly FieldPresentation[];
}) => CognitiveSemanticsProjection | undefined;

function projector(): ProjectCognitiveSemantics {
  const candidate = (engine as Record<string, unknown>).projectCognitiveSemantics;
  expect(candidate, 'engine must export the pure CognitiveSemanticsV1 projector').toBeTypeOf(
    'function',
  );
  return candidate as ProjectCognitiveSemantics;
}

describe('projectCognitiveSemantics', () => {
  it('keeps existing field role/overview projection authoritative and in declaration order', () => {
    const fieldPresentations = [
      {
        path: 'properties.fields.title',
        title: '标题',
        role: 'identity',
        overview: true,
      },
      {
        path: 'properties.fields.body',
        title: '正文',
        role: 'primary-content',
        contentMediaType: 'text/markdown',
      },
    ];

    expect(
      projector()({
        declaration: { version: 1, traits: ['output-catalog'] },
        fieldPresentations,
      }),
    ).toEqual({
      version: 1,
      traits: ['output-catalog'],
      fields: fieldPresentations,
    });
  });

  it('rejects a parallel fields declaration instead of overriding field presentation facts', () => {
    expect(() =>
      projector()({
        declaration: {
          version: 1,
          fields: [{ path: 'properties.summary', title: 'Parallel summary', overview: true }],
        },
        fieldPresentations: [
          {
            path: 'properties.fields.title',
            title: '标题',
            role: 'identity',
            overview: true,
          },
        ],
      }),
    ).toThrow(/fields/i);
  });

  it('does not manufacture a cognitive contract when neither semantics nor fields exist', () => {
    expect(projector()({})).toBeUndefined();
  });
});
