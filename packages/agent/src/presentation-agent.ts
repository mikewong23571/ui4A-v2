/**
 * Independent Presentation Agent adapter.
 *
 * The adapter sees a bounded structural scenario, definition summaries, the live catalog summary,
 * and a few binding-only examples. It never accepts or forwards Chat history. Model output is an
 * untrusted bare Surface template; provenance and dependency metadata are added mechanically.
 */
import {
  SEMANTIC_REGION_ROLES,
  SURFACE_SCHEMA_VERSION,
  type ApplicationRecipeSlot,
  type ApplicationRenderRecipeCandidate,
  type RecipeDependency,
  type ScenarioDescriptor,
  type SemanticRegionRole,
  type SurfaceBinding,
  type SurfaceCatalog,
  type SurfaceCatalogBinding,
  type SurfaceDependency,
  type SurfaceNode,
  type SurfaceProvenance,
  type SurfaceTree,
} from '@ui4a/engine';
import { streamText } from 'ai';

import { createLlmChatModel, type LlmDriverOptions } from './llm-driver';
import { LlmConfigurationError, resolveLlmConfig } from './llm-config';

const MAX_DEFINITIONS = 32;
const MAX_SLOTS = 16;
const MAX_WORDS = 64;
const MAX_BINDINGS_PER_WORD = 32;
const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_BYTES = 12_000;
const MAX_OUTPUT_BYTES = 64_000;
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/;
const STRUCTURAL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const STRUCTURAL_REF = /^[A-Za-z0-9][A-Za-z0-9._:@/#-]{0,255}$/;
const SLOT_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const STRUCTURAL_PATH = /^[A-Za-z_$][A-Za-z0-9_$-]*(?:\.[A-Za-z0-9_$-]+)*$/;
const FORBIDDEN_IDENTITY = /(?:^|[._:/-])(principal|session(?:id)?)(?:$|[._:/-])/i;
const ROLE_SET = new Set<string>(SEMANTIC_REGION_ROLES);
const SCENARIO_KIND_SET = new Set<string>([
  'application-overview',
  'entity-inspect',
  'current-task',
  'collection-browse',
  'confirmation-review',
  'artifact-inspect',
]);

/** Explicit alias documents that generation consumes the pure engine descriptor, not Chat state. */
export type PresentationScenarioDescriptor = ScenarioDescriptor;

export interface PresentationDefinitionSummary {
  kind: 'application' | 'flow' | 'entity' | 'action' | 'capability';
  ref: string;
  version: string;
  /** Structural contract pointers that a property/item binding may dereference at runtime. */
  allowedPointers?: readonly string[];
}

export interface PresentationCatalogBindingSummary {
  name: string;
  sources: SurfaceCatalogBinding['sources'];
  required: boolean;
}

export interface PresentationCatalogWordSummary {
  name: string;
  roles: readonly SemanticRegionRole[];
  bindings: readonly PresentationCatalogBindingSummary[];
}

export interface PresentationCatalogSummary {
  id: string;
  version: string;
  words: readonly PresentationCatalogWordSummary[];
}

export interface PresentationExample {
  scenarioKind: string;
  /** Bare, binding-only template. Dependency and provenance fields are intentionally absent. */
  surfaceTemplate: unknown;
}

export interface PresentationGenerationInput {
  scenario: PresentationScenarioDescriptor;
  definitions: readonly PresentationDefinitionSummary[];
  catalog: PresentationCatalogSummary;
  examples?: readonly PresentationExample[];
}

export type PresentationFailureCode =
  'configuration-unavailable' | 'context-invalid' | 'transport-failed' | 'output-invalid';

export type PresentationGenerationResult =
  | { status: 'candidate'; candidate: ApplicationRenderRecipeCandidate }
  | { status: 'failed'; reasonCode: PresentationFailureCode; issues: string[] };

export interface PresentationAgent {
  generate(input: PresentationGenerationInput): Promise<PresentationGenerationResult>;
}

export interface PresentationAgentOptions extends LlmDriverOptions {
  timeoutMs?: number;
  now?: () => Date;
}

export interface PresentationCandidateProvenance {
  model: string;
  generatedAt: string;
}

interface BareNodeBase {
  id: string;
  role: SemanticRegionRole;
}

type BareSurfaceNode =
  | (BareNodeBase & {
      kind: 'layout';
      layout: 'stack' | 'grid' | 'inline';
      children: BareSurfaceNode[];
    })
  | (BareNodeBase & { kind: 'slot'; name: string; child: BareSurfaceNode })
  | (BareNodeBase & {
      kind: 'repeat';
      source: Extract<SurfaceBinding, { kind: 'entities' }>;
      item: BareSurfaceNode;
    })
  | (BareNodeBase & {
      kind: 'word';
      word: string;
      bindings: Record<string, SurfaceBinding>;
    });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function safeStructuralString(value: string): boolean {
  return STRUCTURAL_REF.test(value) && !FORBIDDEN_IDENTITY.test(value);
}

function failure(
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

function contextIssues(input: PresentationGenerationInput): string[] {
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
    scenario.slots.length === 0 ||
    scenario.slots.length > MAX_SLOTS ||
    new Set(scenario.slots).size !== scenario.slots.length ||
    scenario.slots.some((slot) => !SLOT_NAME.test(slot) || FORBIDDEN_IDENTITY.test(slot))
  ) {
    issues.push('scenario slots are invalid or over budget');
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

function allowedPointers(input: PresentationGenerationInput): Set<string> {
  return new Set(input.definitions.flatMap((definition) => definition.allowedPointers ?? []));
}

function parseSubject(
  value: unknown,
  input: PresentationGenerationInput,
  path: string,
  issues: string[],
): string | undefined {
  if (!nonEmpty(value) || !value.startsWith('$slot:')) {
    issues.push(`${path} must use a declared $slot subject`);
    return undefined;
  }
  const slot = value.slice('$slot:'.length);
  if (!input.scenario.slots.includes(slot)) {
    issues.push(`${path} references unbound slot`);
    return undefined;
  }
  return value;
}

function parsePath(
  value: unknown,
  input: PresentationGenerationInput,
  path: string,
  issues: string[],
): string | undefined {
  if (!nonEmpty(value) || !STRUCTURAL_PATH.test(value) || !allowedPointers(input).has(value)) {
    issues.push(`${path} is not an allowed structural pointer`);
    return undefined;
  }
  return value;
}

function parseBinding(
  value: unknown,
  input: PresentationGenerationInput,
  path: string,
  issues: string[],
): SurfaceBinding | undefined {
  if (!isRecord(value) || !nonEmpty(value.kind)) {
    issues.push(`${path} is not a binding object`);
    return undefined;
  }
  switch (value.kind) {
    case 'property': {
      if (!exactKeys(value, ['kind', 'subject', 'path'])) {
        issues.push(`${path} contains factual or unknown fields`);
        return undefined;
      }
      const subject = parseSubject(value.subject, input, `${path}.subject`, issues);
      const bindingPath = parsePath(value.path, input, `${path}.path`, issues);
      return subject === undefined || bindingPath === undefined
        ? undefined
        : { kind: 'property', subject, path: bindingPath };
    }
    case 'actions':
    case 'links':
    case 'entities': {
      if (!exactKeys(value, ['kind', 'subject'])) {
        issues.push(`${path} contains factual or unknown fields`);
        return undefined;
      }
      const subject = parseSubject(value.subject, input, `${path}.subject`, issues);
      return subject === undefined ? undefined : { kind: value.kind, subject };
    }
    case 'item': {
      if (!exactKeys(value, ['kind', 'path'])) {
        issues.push(`${path} contains factual or unknown fields`);
        return undefined;
      }
      const bindingPath = parsePath(value.path, input, `${path}.path`, issues);
      return bindingPath === undefined ? undefined : { kind: 'item', path: bindingPath };
    }
    default:
      issues.push(`${path}.kind is unknown`);
      return undefined;
  }
}

function parseNodeBase(
  value: Record<string, unknown>,
  path: string,
  issues: string[],
): BareNodeBase | undefined {
  if (!nonEmpty(value.id) || !IDENTIFIER.test(value.id)) issues.push(`${path}.id is invalid`);
  if (!nonEmpty(value.role) || !ROLE_SET.has(value.role)) issues.push(`${path}.role is invalid`);
  if (issues.some((issue) => issue.startsWith(`${path}.id`) || issue.startsWith(`${path}.role`))) {
    return undefined;
  }
  return { id: value.id as string, role: value.role as SemanticRegionRole };
}

function parseBareNode(
  value: unknown,
  input: PresentationGenerationInput,
  path: string,
  issues: string[],
): BareSurfaceNode | undefined {
  if (!isRecord(value) || !nonEmpty(value.kind)) {
    issues.push(`${path} is not a Surface node`);
    return undefined;
  }
  const base = parseNodeBase(value, path, issues);
  if (base === undefined) return undefined;
  switch (value.kind) {
    case 'layout': {
      if (
        !exactKeys(value, ['kind', 'id', 'role', 'layout', 'children']) ||
        !['stack', 'grid', 'inline'].includes(String(value.layout)) ||
        !Array.isArray(value.children) ||
        value.children.length === 0 ||
        value.children.length > 32
      ) {
        issues.push(`${path} layout shape is invalid or contains literal fields`);
        return undefined;
      }
      const children = value.children.map((child, index) =>
        parseBareNode(child, input, `${path}.children[${index}]`, issues),
      );
      return children.some((child) => child === undefined)
        ? undefined
        : {
            ...base,
            kind: 'layout',
            layout: value.layout as 'stack' | 'grid' | 'inline',
            children: children as BareSurfaceNode[],
          };
    }
    case 'slot': {
      if (
        !exactKeys(value, ['kind', 'id', 'role', 'name', 'child']) ||
        !nonEmpty(value.name) ||
        !STRUCTURAL_NAME.test(value.name)
      ) {
        issues.push(`${path} slot shape is invalid or contains literal fields`);
        return undefined;
      }
      const child = parseBareNode(value.child, input, `${path}.child`, issues);
      return child === undefined ? undefined : { ...base, kind: 'slot', name: value.name, child };
    }
    case 'repeat': {
      if (!exactKeys(value, ['kind', 'id', 'role', 'source', 'item'])) {
        issues.push(`${path} repeat shape is invalid or contains literal fields`);
        return undefined;
      }
      const source = parseBinding(value.source, input, `${path}.source`, issues);
      const item = parseBareNode(value.item, input, `${path}.item`, issues);
      return source?.kind !== 'entities' || item === undefined
        ? undefined
        : { ...base, kind: 'repeat', source, item };
    }
    case 'word': {
      if (
        !exactKeys(value, ['kind', 'id', 'role', 'word', 'bindings']) ||
        !nonEmpty(value.word) ||
        !isRecord(value.bindings)
      ) {
        issues.push(`${path} word shape is invalid or contains literal fields`);
        return undefined;
      }
      const word = input.catalog.words.find(({ name }) => name === value.word);
      if (word === undefined || !word.roles.includes(base.role)) {
        issues.push(`${path}.word is unknown or incompatible with its semantic role`);
        return undefined;
      }
      const bindingSpecs = new Map(word.bindings.map((binding) => [binding.name, binding]));
      const bindings: Record<string, SurfaceBinding> = {};
      for (const [name, bindingValue] of Object.entries(value.bindings)) {
        const spec = bindingSpecs.get(name);
        const binding = parseBinding(bindingValue, input, `${path}.bindings.${name}`, issues);
        if (spec === undefined || binding === undefined || !spec.sources.includes(binding.kind)) {
          issues.push(`${path}.bindings.${name} is unknown or has an incompatible source`);
          continue;
        }
        bindings[name] = binding;
      }
      for (const spec of word.bindings) {
        if (spec.required && bindings[spec.name] === undefined) {
          issues.push(`${path}.bindings.${spec.name} is required`);
        }
      }
      return issues.some((issue) => issue.startsWith(`${path}.bindings`))
        ? undefined
        : { ...base, kind: 'word', word: value.word, bindings };
    }
    default:
      issues.push(`${path}.kind is unknown`);
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

function slotKind(input: PresentationGenerationInput, name: string): ApplicationRecipeSlot['kind'] {
  if (name === 'members' || input.scenario.subjectShape.startsWith('collection:')) {
    return 'collection';
  }
  if (name === 'subject.node' || input.scenario.subjectShape.startsWith('flow-instance:')) {
    return 'flow';
  }
  if (name.startsWith('target.') || name.startsWith('source.')) return 'selection';
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
    const surfaceTemplate: SurfaceTree = {
      schemaVersion: SURFACE_SCHEMA_VERSION,
      root: withTrustedMetadata(root, input, provenance),
    };
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
        slots: input.scenario.slots.map((name) => ({ name, kind: slotKind(input, name) })),
        surfaceTemplate,
        dependencies,
        provenance,
      },
    };
  } catch {
    return failure('output-invalid', ['model output could not be validated']);
  }
}

/** Provider-neutral, injected-transport Presentation Agent. */
export function createPresentationAgent(options: PresentationAgentOptions = {}): PresentationAgent {
  return {
    async generate(input): Promise<PresentationGenerationResult> {
      const issues = contextIssues(input);
      if (issues.length > 0) return failure('context-invalid', issues);
      let config: ReturnType<typeof resolveLlmConfig>;
      try {
        config = resolveLlmConfig(options);
      } catch (error) {
        if (error instanceof LlmConfigurationError) {
          return failure('configuration-unavailable', [error.message]);
        }
        return failure('configuration-unavailable', ['LLM profile could not be resolved']);
      }
      try {
        const result = streamText({
          model: createLlmChatModel(options),
          system:
            'You are an independent UI4A Presentation Agent. Return only the requested binding-only JSON template.',
          prompt: buildPresentationPrompt(input),
          abortSignal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
          maxRetries: 0,
        });
        let text = '';
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') text += part.text;
          else if (part.type === 'error') throw part.error;
          else if (part.type === 'abort') throw new Error(part.reason ?? 'presentation aborted');
        }
        return parsePresentationCandidate(text, input, {
          model: config.model,
          generatedAt: (options.now?.() ?? new Date()).toISOString(),
        });
      } catch {
        return failure('transport-failed', ['Presentation LLM request failed']);
      }
    },
  };
}
