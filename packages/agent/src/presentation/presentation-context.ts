/**
 * Presentation 生成上下文校验与 prompt 组装(从 presentation-agent.ts 拆出,行为不变)。
 * 适配器只见有界结构场景、定义摘要、实时 catalog 摘要与少量 binding-only 示例,
 * 绝不接受或转发 Chat history。
 */
import { SEMANTIC_REGION_ROLES, SURFACE_SCHEMA_VERSION, type SurfaceCatalog } from '@ui4a/engine';

import {
  FORBIDDEN_IDENTITY,
  MAX_BINDINGS_PER_WORD,
  MAX_DEFINITIONS,
  MAX_EXAMPLE_BYTES,
  MAX_EXAMPLES,
  MAX_WORDS,
  ROLE_SET,
  SCENARIO_KIND_SET,
  SLOT_NAME,
  STRUCTURAL_NAME,
  STRUCTURAL_PATH,
  exactKeys,
  isRecord,
  nonEmpty,
  parseBareNode,
  safeStructuralString,
} from './presentation-template';
import type {
  PresentationCatalogSummary,
  PresentationFailureCode,
  PresentationGenerationInput,
  PresentationGenerationResult,
} from './presentation-types';

export function failure(
  reasonCode: PresentationFailureCode,
  issues: readonly string[],
): PresentationGenerationResult {
  return { status: 'failed', reasonCode, issues: [...issues] };
}

/** Convert the live catalog to the only catalog detail the planning model needs. */
export function summarizePresentationCatalog(catalog: SurfaceCatalog): PresentationCatalogSummary {
  return {
    id: catalog.id,
    version: catalog.version,
    words: Object.entries(catalog.words)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, word]) => ({
        name,
        roles: [...word.roles],
        bindings: Object.entries(word.bindings)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([bindingName, binding]) => ({
            name: bindingName,
            sources: [...binding.sources],
            required: binding.required === true,
          })),
      })),
  };
}

export function contextIssues(input: PresentationGenerationInput): string[] {
  const issues: string[] = [];
  const { scenario } = input;
  if (
    !nonEmpty(scenario.key) ||
    !safeStructuralString(scenario.key) ||
    !nonEmpty(scenario.kind) ||
    !SCENARIO_KIND_SET.has(scenario.kind) ||
    !nonEmpty(scenario.subjectShape) ||
    !safeStructuralString(scenario.subjectShape) ||
    !nonEmpty(scenario.intent) ||
    !STRUCTURAL_NAME.test(scenario.intent)
  ) {
    issues.push('scenario identity is invalid');
  }
  if (
    scenario.slots.length !== 1 ||
    scenario.slots[0] !== 'subject' ||
    !SLOT_NAME.test(scenario.slots[0]) ||
    FORBIDDEN_IDENTITY.test(scenario.slots[0])
  ) {
    issues.push('scenario must declare the canonical subject region slot');
  }
  if (
    scenario.definitionRefs.length === 0 ||
    scenario.definitionRefs.length > MAX_DEFINITIONS ||
    scenario.definitionRefs.some((ref) => !safeStructuralString(ref))
  ) {
    issues.push('scenario definition references are invalid or over budget');
  }
  if (
    input.definitions.length === 0 ||
    input.definitions.length > MAX_DEFINITIONS ||
    input.definitions.some(
      (definition) =>
        !safeStructuralString(definition.ref) ||
        !safeStructuralString(definition.version) ||
        (definition.allowedPointers?.some(
          (path) => !STRUCTURAL_PATH.test(path) || FORBIDDEN_IDENTITY.test(path),
        ) ??
          false),
    )
  ) {
    issues.push('definition context is invalid or over budget');
  }
  const definitionRefs = new Set(input.definitions.map(({ ref }) => ref));
  if (scenario.definitionRefs.some((ref) => !definitionRefs.has(ref))) {
    issues.push('scenario has an unbound definition reference');
  }
  const applications = input.definitions.filter(({ kind }) => kind === 'application');
  if (applications.length !== 1) issues.push('definition context must contain one application');
  if (
    !safeStructuralString(input.catalog.id) ||
    !safeStructuralString(input.catalog.version) ||
    input.catalog.words.length === 0 ||
    input.catalog.words.length > MAX_WORDS ||
    input.catalog.words.some(
      (word) =>
        !STRUCTURAL_NAME.test(word.name) ||
        word.roles.length === 0 ||
        word.roles.some((role) => !ROLE_SET.has(role)) ||
        word.bindings.length > MAX_BINDINGS_PER_WORD ||
        word.bindings.some(
          (binding) =>
            !STRUCTURAL_NAME.test(binding.name) ||
            binding.sources.length === 0 ||
            binding.sources.some(
              (source) => !['property', 'actions', 'links', 'entities', 'item'].includes(source),
            ),
        ),
    )
  ) {
    issues.push('catalog summary is invalid or over budget');
  }
  const examples = input.examples ?? [];
  if (
    examples.length > MAX_EXAMPLES ||
    examples.some(
      (example) =>
        !safeStructuralString(example.scenarioKind) ||
        JSON.stringify(example.surfaceTemplate).length > MAX_EXAMPLE_BYTES,
    )
  ) {
    issues.push('examples are invalid or over budget');
  } else {
    for (const example of examples) {
      const exampleIssues: string[] = [];
      const envelope = example.surfaceTemplate;
      if (
        !isRecord(envelope) ||
        !exactKeys(envelope, ['schemaVersion', 'root']) ||
        envelope.schemaVersion !== SURFACE_SCHEMA_VERSION ||
        parseBareNode(envelope.root, input, 'example.root', exampleIssues) === undefined ||
        exampleIssues.length > 0
      ) {
        issues.push('example contains an invalid or factual Surface template');
      }
    }
  }
  return issues;
}

function promptProjection(input: PresentationGenerationInput): Record<string, unknown> {
  return {
    scenario: {
      key: input.scenario.key,
      kind: input.scenario.kind,
      subjectShape: input.scenario.subjectShape,
      intent: input.scenario.intent,
      definitionRefs: input.scenario.definitionRefs,
      slots: input.scenario.slots,
      versions: input.scenario.versions,
    },
    definitions: input.definitions.map(({ kind, ref, version, allowedPointers }) => ({
      kind,
      ref,
      version,
      ...(allowedPointers === undefined ? {} : { allowedPointers }),
    })),
    catalog: input.catalog,
    examples: (input.examples ?? []).map(({ scenarioKind, surfaceTemplate }) => ({
      scenarioKind,
      surfaceTemplate,
    })),
  };
}

/**
 * Build a fresh Presentation-only prompt. The explicit projection is intentional: runtime callers
 * cannot smuggle principal/session/Chat fields into model context through excess object properties.
 */
export function buildPresentationPrompt(input: PresentationGenerationInput): string {
  return [
    '你是 UI4A 独立 Presentation Agent。根据结构化场景生成参数化 binding-only Surface template。',
    '输入不含 Chat history、principal、session 或实时 Entity 值；不得猜测或补充这些内容。',
    '只输出一个 JSON 对象，形状为 {"schemaVersion":1,"root":<node>}，不要 Markdown。',
    [
      'node 只允许以下精确形状（不得添加 title/text/value/facts）：',
      `- semantic-role 必须逐字取自: ${SEMANTIC_REGION_ROLES.join(', ')}；根 layout 使用 primary-content。`,
      '- layout: {"kind":"layout","id":"kebab-id","role":"<semantic-role>","layout":"stack|grid|inline","children":[<node>,...]}',
      '- slot: {"kind":"slot","id":"kebab-id","role":"<semantic-role>","name":"semantic-name","child":<node>}',
      '- repeat: {"kind":"repeat","id":"kebab-id","role":"relation","source":{"kind":"entities","subject":"$slot:<slot>"},"item":<node>}',
      '- word: {"kind":"word","id":"kebab-id","role":"<semantic-role>","word":"<catalog-word>","bindings":{"<catalog-binding>":<binding>}}',
      '- property binding: {"kind":"property","subject":"$slot:<slot>","path":"<allowedPointer>"}',
      '- actions/links/entities binding: {"kind":"actions|links|entities","subject":"$slot:<slot>"}',
      '- item binding: {"kind":"item","path":"<allowedPointer>"}',
    ].join('\n'),
    'word 必须来自实时 catalog；binding 必须来自该 word 声明，并使用允许的 source kind。',
    '非 item binding 的 subject 必须是 "$slot:<scenario slot>"；不得输出具体 rel。',
    'property/item path 必须来自 definition allowedPointers；不得输出 dependency/provenance，它们由系统添加。',
    `## Bounded presentation context\n${JSON.stringify(promptProjection(input), null, 2)}`,
  ].join('\n\n');
}
