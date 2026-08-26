/**
 * 模型输出 → 可信 Recipe candidate 的解析与机械元数据注入
 * (从 presentation-agent.ts 拆出,行为不变)。provenance 与 dependency
 * 元数据由系统机械添加,模型永远接触不到。
 */
import {
  assembleSurfaceRegions,
  SURFACE_SCHEMA_VERSION,
  type ApplicationRecipeSlot,
  type RecipeDependency,
  type SurfaceBinding,
  type SurfaceDependency,
  type SurfaceNode,
  type SurfaceProvenance,
  type SurfaceTree,
} from '@ui4a/engine';

import { contextIssues, failure } from './presentation-context';
import {
  MAX_OUTPUT_BYTES,
  exactKeys,
  isRecord,
  parseBareNode,
  type BareSurfaceNode,
} from './presentation-template';
import type {
  PresentationCandidateProvenance,
  PresentationGenerationInput,
  PresentationGenerationResult,
} from './presentation-types';

function extractJson(text: string): unknown {
  if (text.length > MAX_OUTPUT_BYTES) return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const candidate = fenced?.[1] ?? (start >= 0 && end >= start ? text.slice(start, end + 1) : '');
  if (candidate.trim() === '') return undefined;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}

function bindingDependency(binding: SurfaceBinding): SurfaceDependency | undefined {
  if (binding.kind === 'item') return undefined;
  const paths =
    binding.kind === 'property'
      ? [binding.path]
      : binding.kind === 'actions'
        ? ['$actions']
        : binding.kind === 'links'
          ? ['$links']
          : ['$entities'];
  return { kind: 'entity', subject: binding.subject, version: '$runtime', paths };
}

function withTrustedMetadata(
  node: BareSurfaceNode,
  input: PresentationGenerationInput,
  provenance: PresentationCandidateProvenance,
): SurfaceNode {
  const nodeProvenance: SurfaceProvenance[] = [
    { kind: 'presentation-agent', ref: input.scenario.key, model: provenance.model },
  ];
  const catalogDependency: SurfaceDependency = {
    kind: 'catalog',
    subject: input.catalog.id,
    version: input.catalog.version,
  };
  switch (node.kind) {
    case 'layout':
      return {
        ...node,
        dependencies: [],
        provenance: nodeProvenance,
        children: node.children.map((child) => withTrustedMetadata(child, input, provenance)),
      };
    case 'slot':
      return {
        ...node,
        dependencies: [],
        provenance: nodeProvenance,
        child: withTrustedMetadata(node.child, input, provenance),
      };
    case 'repeat': {
      const dependency = bindingDependency(node.source)!;
      return {
        ...node,
        dependencies: [dependency],
        provenance: nodeProvenance,
        item: withTrustedMetadata(node.item, input, provenance),
      };
    }
    case 'word': {
      const dependencies = new Map<string, SurfaceDependency>();
      dependencies.set(`catalog\0${input.catalog.id}`, catalogDependency);
      for (const binding of Object.values(node.bindings)) {
        const dependency = bindingDependency(binding);
        if (dependency === undefined) continue;
        const key = `${dependency.kind}\0${dependency.subject}`;
        const previous = dependencies.get(key);
        dependencies.set(key, {
          ...dependency,
          paths: [...new Set([...(previous?.paths ?? []), ...(dependency.paths ?? [])])].sort(),
        });
      }
      return { ...node, dependencies: [...dependencies.values()], provenance: nodeProvenance };
    }
  }
}

function slotKind(input: PresentationGenerationInput): ApplicationRecipeSlot['kind'] {
  if (input.scenario.subjectShape.startsWith('collection:')) {
    return 'collection';
  }
  if (input.scenario.subjectShape.startsWith('flow-instance:')) {
    return 'flow';
  }
  return 'entity';
}

function applicationIdentity(input: PresentationGenerationInput): {
  name: string;
  version: string;
} {
  const application = input.definitions.find(({ kind }) => kind === 'application')!;
  const withoutPrefix = application.ref.startsWith('application:')
    ? application.ref.slice('application:'.length)
    : application.ref;
  return { name: withoutPrefix.replace(/@[^@]+$/, ''), version: application.version };
}

/** Parse and validate model output. Invalid model output is always a structured, non-throwing result. */
export function parsePresentationCandidate(
  text: string,
  input: PresentationGenerationInput,
  provenance: PresentationCandidateProvenance,
): PresentationGenerationResult {
  try {
    const contextErrors = contextIssues(input);
    if (contextErrors.length > 0) return failure('context-invalid', contextErrors);
    const parsed = extractJson(text);
    if (!isRecord(parsed) || !exactKeys(parsed, ['schemaVersion', 'root'])) {
      return failure('output-invalid', ['model output is not an exact bare Surface envelope']);
    }
    if (parsed.schemaVersion !== SURFACE_SCHEMA_VERSION) {
      return failure('output-invalid', ['Surface schema version is unsupported']);
    }
    const issues: string[] = [];
    const root = parseBareNode(parsed.root, input, 'root', issues);
    if (root === undefined || issues.length > 0) return failure('output-invalid', issues);
    const subtree: SurfaceTree = {
      schemaVersion: SURFACE_SCHEMA_VERSION,
      root: withTrustedMetadata(root, input, provenance),
    };
    const trustedProvenance: SurfaceProvenance[] = [
      { kind: 'presentation-agent', ref: input.scenario.key, model: provenance.model },
    ];
    const surfaceTemplate = assembleSurfaceRegions(
      [
        {
          region: 'subject',
          surface: subtree,
          provenance: trustedProvenance,
        },
      ],
      { provenance: trustedProvenance },
    );
    const application = applicationIdentity(input);
    const dependencies: RecipeDependency[] = [
      ...input.definitions.map(({ ref, version, allowedPointers }) => ({
        kind: 'definition' as const,
        subject: ref,
        version,
        ...(allowedPointers === undefined ? {} : { paths: [...allowedPointers] }),
      })),
      { kind: 'catalog', subject: input.catalog.id, version: input.catalog.version },
    ];
    return {
      status: 'candidate',
      candidate: {
        key: {
          application: application.name,
          applicationVersion: application.version,
          scenario: input.scenario.key,
          subjectShape: input.scenario.subjectShape,
          intent: input.scenario.intent,
          catalogVersion: input.catalog.version,
        },
        slots: input.scenario.slots.map((name) => ({ name, kind: slotKind(input) })),
        surfaceTemplate,
        dependencies,
        provenance,
      },
    };
  } catch {
    return failure('output-invalid', ['model output could not be validated']);
  }
}
