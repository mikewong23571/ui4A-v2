import {
  A2uiMessageListSchema,
  MessageProcessor,
  type A2uiMessage,
  type ComponentApi,
} from '@a2ui/web_core/v0_9';
import {
  hashSurfaceTree,
  validateSurfaceTree,
  type SurfaceBinding,
  type SurfaceCatalog,
  type SurfaceNode,
  type SurfaceTree,
  type SurfaceValidationIssue,
} from '@ui4a/engine';

import type {
  A2uiCatalogAdapter,
  A2uiHydrationTransform,
  A2uiWordAdapter,
} from './catalog-adapter';

export interface A2uiCompileIssue {
  code: string;
  nodeId: string;
  path: string;
  message: string;
}

/** Ephemeral hydrated runtime output. Sidecars persist the binding-only SurfaceTree, never this. */
export interface A2uiMessageBundle {
  schemaVersion: 1;
  protocolVersion: 'v0.9';
  surfaceId: string;
  surfaceHash: string;
  catalogId: string;
  catalogFingerprint: string;
  messages: A2uiMessage[];
  issues: Array<SurfaceValidationIssue | A2uiCompileIssue>;
  bundleFingerprint: string;
}

export type SurfaceDeref = (binding: SurfaceBinding, nodeId: string) => unknown;

export interface CompileSurfaceTreeOptions {
  surfaceId: string;
  catalog: SurfaceCatalog;
  catalogAdapter: A2uiCatalogAdapter;
  expectedCatalogFingerprint: string;
  deref: SurfaceDeref;
}

export interface A2uiReplayResult {
  processor: MessageProcessor<ComponentApi>;
}

interface HydrationModel {
  values: Record<string, Record<string, unknown>>;
  repeats: Record<string, unknown>;
  diagnostics: Record<string, string>;
}

interface CompileContext {
  options: CompileSurfaceTreeOptions;
  components: Record<string, unknown>[];
  hydration: HydrationModel;
  issues: Array<SurfaceValidationIssue | A2uiCompileIssue>;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

function bundleFingerprint(bundle: Omit<A2uiMessageBundle, 'bundleFingerprint'>): string {
  return fnv1a64(canonicalJson(bundle));
}

function pointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function itemPath(path: string): string {
  return path
    .split('.')
    .filter((segment) => segment !== '')
    .map(pointerSegment)
    .join('/');
}

function componentId(node: SurfaceNode, isRoot: boolean): string {
  return isRoot ? 'root' : `node:${encodeURIComponent(node.id)}`;
}

function compileIssue(node: SurfaceNode, code: string, message: string): A2uiCompileIssue {
  return { code, nodeId: node.id, path: node.id, message };
}

function emitDiagnostic(
  node: SurfaceNode,
  isRoot: boolean,
  code: string,
  context: CompileContext,
): string {
  const id = componentId(node, isRoot);
  context.hydration.diagnostics[node.id] = code;
  context.components.push({
    id,
    component: context.options.catalogAdapter.diagnosticComponent,
    text: { path: `/ui4a/diagnostics/${pointerSegment(node.id)}` },
    variant: 'caption',
  });
  return id;
}

function transformedValue(
  transform: A2uiHydrationTransform,
  binding: SurfaceBinding,
  value: unknown,
): unknown {
  if (transform === 'value') return value;
  const subject = binding.kind === 'item' ? '' : binding.subject;
  if (transform === 'actions-entity') {
    return {
      class: ['presentation-action-slice'],
      properties: { rel: subject },
      actions: value,
      links: [],
    };
  }
  return {
    class: ['presentation-link-slice'],
    properties: { rel: subject },
    actions: [],
    links: value,
  };
}

function compileWord(
  node: Extract<SurfaceNode, { kind: 'word' }>,
  isRoot: boolean,
  context: CompileContext,
): string {
  const adapter: A2uiWordAdapter | undefined = context.options.catalogAdapter.words[node.word];
  if (adapter === undefined) {
    context.issues.push(
      compileIssue(node, 'catalog-adapter-missing', `word "${node.word}" has no A2UI adapter`),
    );
    return emitDiagnostic(node, isRoot, 'catalog-adapter-missing', context);
  }

  const props: Record<string, unknown> = { ...adapter.props };
  const hydrated: Record<string, unknown> = {};
  try {
    for (const [bindingName, bindingAdapter] of Object.entries(adapter.bindings)) {
      const binding = node.bindings[bindingName];
      if (binding === undefined) {
        throw new Error(`binding "${bindingName}" is missing`);
      }
      if (binding.kind === 'item') {
        if (bindingAdapter.transform !== 'value') {
          throw new Error(`item binding "${bindingName}" cannot use an entity transform`);
        }
        props[bindingAdapter.prop] = { path: itemPath(binding.path) };
        continue;
      }
      const value = context.options.deref(binding, node.id);
      if (value === undefined) throw new Error(`binding "${bindingName}" resolved to undefined`);
      hydrated[bindingName] = transformedValue(bindingAdapter.transform, binding, value);
      props[bindingAdapter.prop] = {
        path: `/ui4a/values/${pointerSegment(node.id)}/${pointerSegment(bindingName)}`,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'deref failed';
    context.issues.push(compileIssue(node, 'deref-failed', message));
    return emitDiagnostic(node, isRoot, 'deref-failed', context);
  }

  if (Object.keys(hydrated).length > 0) context.hydration.values[node.id] = hydrated;
  const id = componentId(node, isRoot);
  context.components.push({ id, component: adapter.component, ...props });
  return id;
}

function compileNode(node: SurfaceNode, isRoot: boolean, context: CompileContext): string {
  if (node.kind === 'diagnostic') {
    return emitDiagnostic(node, isRoot, node.code, context);
  }
  if (node.kind === 'word') return compileWord(node, isRoot, context);

  if (node.kind === 'repeat') {
    let items: unknown;
    try {
      items = context.options.deref(node.source, node.id);
      if (!Array.isArray(items)) throw new Error('repeat source must resolve to an array');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'repeat deref failed';
      context.issues.push(compileIssue(node, 'deref-failed', message));
      return emitDiagnostic(node, isRoot, 'deref-failed', context);
    }
    context.hydration.repeats[node.id] = items;
    const item = compileNode(node.item, false, context);
    const id = componentId(node, isRoot);
    context.components.push({
      id,
      component: context.options.catalogAdapter.repeatComponent,
      children: {
        componentId: item,
        path: `/ui4a/repeats/${pointerSegment(node.id)}`,
      },
    });
    return id;
  }

  const children =
    node.kind === 'slot'
      ? [compileNode(node.child, false, context)]
      : node.children.map((child) => compileNode(child, false, context));
  const id = componentId(node, isRoot);
  context.components.push({
    id,
    component:
      node.kind === 'slot'
        ? context.options.catalogAdapter.slotComponent
        : context.options.catalogAdapter.layouts[node.layout],
    children,
  });
  return id;
}

function assertCatalogFingerprint(expected: string, adapter: A2uiCatalogAdapter): void {
  if (expected !== adapter.fingerprint) {
    throw new Error(
      `A2UI catalog fingerprint mismatch: expected "${expected}", current "${adapter.fingerprint}"`,
    );
  }
}

export function compileSurfaceTree(
  surface: SurfaceTree,
  options: CompileSurfaceTreeOptions,
): A2uiMessageBundle {
  assertCatalogFingerprint(options.expectedCatalogFingerprint, options.catalogAdapter);
  if (options.surfaceId.trim() === '') throw new Error('surfaceId must not be empty');

  const validation = validateSurfaceTree(surface, options.catalog);
  const context: CompileContext = {
    options,
    components: [],
    hydration: { values: {}, repeats: {}, diagnostics: {} },
    issues: [...validation.issues],
  };
  compileNode(validation.surface.root, true, context);
  const messages: A2uiMessage[] = [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: options.surfaceId,
        catalogId: options.catalogAdapter.catalogId,
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: options.surfaceId,
        path: '/ui4a',
        value: context.hydration,
      },
    },
    {
      version: 'v0.9',
      updateComponents: { surfaceId: options.surfaceId, components: context.components },
    },
  ];
  const unsigned: Omit<A2uiMessageBundle, 'bundleFingerprint'> = {
    schemaVersion: 1,
    protocolVersion: 'v0.9',
    surfaceId: options.surfaceId,
    surfaceHash: hashSurfaceTree(validation.surface),
    catalogId: options.catalogAdapter.catalogId,
    catalogFingerprint: options.catalogAdapter.fingerprint,
    messages,
    issues: context.issues,
  };
  return { ...unsigned, bundleFingerprint: bundleFingerprint(unsigned) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verifyBundle(value: unknown, adapter: A2uiCatalogAdapter): A2uiMessageBundle {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.protocolVersion !== 'v0.9' ||
    typeof value.surfaceId !== 'string' ||
    typeof value.surfaceHash !== 'string' ||
    value.catalogId !== adapter.catalogId ||
    value.catalogFingerprint !== adapter.fingerprint ||
    typeof value.bundleFingerprint !== 'string' ||
    !Array.isArray(value.issues)
  ) {
    throw new Error('A2UI bundle envelope or catalog fingerprint is invalid');
  }
  const parsedMessages = A2uiMessageListSchema.safeParse(value.messages);
  if (!parsedMessages.success || parsedMessages.data.length !== 3) {
    throw new Error('A2UI bundle messages are invalid');
  }
  const bundle = {
    schemaVersion: 1 as const,
    protocolVersion: 'v0.9' as const,
    surfaceId: value.surfaceId,
    surfaceHash: value.surfaceHash,
    catalogId: value.catalogId,
    catalogFingerprint: value.catalogFingerprint,
    messages: parsedMessages.data,
    issues: value.issues as Array<SurfaceValidationIssue | A2uiCompileIssue>,
    bundleFingerprint: value.bundleFingerprint,
  };
  const { bundleFingerprint: actual, ...unsigned } = bundle;
  if (bundleFingerprint(unsigned) !== actual) throw new Error('A2UI bundle fingerprint is invalid');
  return bundle;
}

export function serializeA2uiBundle(bundle: A2uiMessageBundle): string {
  return canonicalJson(bundle);
}

export function restoreA2uiBundle(
  serialized: string,
  adapter: A2uiCatalogAdapter,
): A2uiMessageBundle {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new Error('A2UI bundle is not valid JSON');
  }
  return verifyBundle(value, adapter);
}

export function replayA2uiBundle(
  bundle: A2uiMessageBundle,
  adapter: A2uiCatalogAdapter,
): A2uiReplayResult {
  const verified = verifyBundle(bundle, adapter);
  const processor = new MessageProcessor([adapter.runtimeCatalog]);
  processor.processMessages(verified.messages);
  return { processor };
}
