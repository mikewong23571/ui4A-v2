import type { SirenEntity } from '../siren';

export const SURFACE_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_REGION_ROLES = [
  'identity',
  'status',
  'primary-content',
  'metadata',
  'relation',
  'actions',
  'diagnostic',
] as const;

export type SemanticRegionRole = (typeof SEMANTIC_REGION_ROLES)[number];
export type SurfaceLayout = 'stack' | 'grid' | 'inline';
export type SurfaceBindingKind = 'property' | 'actions' | 'links' | 'entities' | 'item';
export type SurfaceBinding =
  | { kind: 'property'; subject: string; path: string }
  | { kind: 'actions'; subject: string }
  | { kind: 'links'; subject: string }
  | { kind: 'entities'; subject: string }
  | { kind: 'item'; path: string };

export interface SurfaceDependency {
  kind: 'entity' | 'definition' | 'catalog';
  subject: string;
  version: string;
  paths?: string[];
}

export interface SurfaceProvenance {
  kind:
    'application-recipe' | 'presentation-agent' | 'generic-fallback' | 'human-patch' | 'validator';
  ref: string;
  model?: string;
}

interface SurfaceNodeBase {
  id: string;
  role: SemanticRegionRole;
  dependencies: SurfaceDependency[];
  provenance: SurfaceProvenance[];
}

export interface SurfaceLayoutNode extends SurfaceNodeBase {
  kind: 'layout';
  layout: SurfaceLayout;
  children: SurfaceNode[];
}

export interface SurfaceSlotNode extends SurfaceNodeBase {
  kind: 'slot';
  name: string;
  child: SurfaceNode;
}

export interface SurfaceRepeatNode extends SurfaceNodeBase {
  kind: 'repeat';
  source: Extract<SurfaceBinding, { kind: 'entities' }>;
  item: SurfaceNode;
}

export interface SurfaceWordNode extends SurfaceNodeBase {
  kind: 'word';
  word: string;
  bindings: Record<string, SurfaceBinding>;
}

/** Trusted validator output. It intentionally contains no binding or executable control. */
export interface SurfaceDiagnosticNode extends SurfaceNodeBase {
  kind: 'diagnostic';
  code: string;
  failedNodeId?: string;
}

export type SurfaceNode =
  SurfaceLayoutNode | SurfaceSlotNode | SurfaceRepeatNode | SurfaceWordNode | SurfaceDiagnosticNode;

export interface SurfaceTree {
  schemaVersion: typeof SURFACE_SCHEMA_VERSION;
  root: SurfaceNode;
}

export interface SurfaceCatalogBinding {
  sources: SurfaceBindingKind[];
  required?: boolean;
}

export interface SurfaceCatalogWord {
  roles: SemanticRegionRole[];
  bindings: Record<string, SurfaceCatalogBinding>;
}

export interface SurfaceCatalog {
  id: string;
  version: string;
  words: Record<string, SurfaceCatalogWord>;
}

export interface SurfaceCatalogValidationResult {
  valid: boolean;
  errors: string[];
}

export type SurfaceIssueCode =
  | 'surface-invalid'
  | 'node-invalid'
  | 'node-id-duplicate'
  | 'binding-invalid'
  | 'unknown-binding'
  | 'required-binding-missing'
  | 'binding-source-invalid'
  | 'dependency-invalid'
  | 'dependency-missing'
  | 'catalog-invalid'
  | 'catalog-dependency-invalid'
  | 'unknown-word'
  | 'word-role-invalid'
  | 'serialization-invalid';

export interface SurfaceValidationIssue {
  code: SurfaceIssueCode;
  nodeId: string;
  path: string;
  message: string;
}

export interface SurfaceValidationResult {
  valid: boolean;
  surface: SurfaceTree;
  issues: SurfaceValidationIssue[];
}

export interface GenericSurfaceOptions {
  entityVersion: string;
  semanticHints?: Readonly<Record<string, SemanticRegionRole>>;
  provenanceRef?: string;
}

const ROLE_SET = new Set<string>(SEMANTIC_REGION_ROLES);
const LAYOUT_SET = new Set<string>(['stack', 'grid', 'inline']);
const PROVENANCE_KIND_SET = new Set<string>([
  'application-recipe',
  'presentation-agent',
  'generic-fallback',
  'human-patch',
  'validator',
]);
const DEPENDENCY_KIND_SET = new Set<string>(['entity', 'definition', 'catalog']);
const BINDING_KIND_SET = new Set<string>(['property', 'actions', 'links', 'entities', 'item']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function issue(
  issues: SurfaceValidationIssue[],
  code: SurfaceIssueCode,
  nodeId: string,
  path: string,
  message: string,
): void {
  issues.push({ code, nodeId, path, message });
}

function diagnosticNode(path: string, code: string, failedNodeId?: string): SurfaceDiagnosticNode {
  return {
    kind: 'diagnostic',
    id: `diagnostic:${path}`,
    role: 'diagnostic',
    code,
    ...(failedNodeId === undefined ? {} : { failedNodeId }),
    dependencies: [],
    provenance: [{ kind: 'validator', ref: code }],
  };
}

export function validateSurfaceCatalog(value: unknown): SurfaceCatalogValidationResult {
  const errors: string[] = [];
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['id', 'version', 'words']) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.version) ||
    !isRecord(value.words)
  ) {
    return { valid: false, errors: ['catalog envelope is invalid'] };
  }
  for (const [word, definition] of Object.entries(value.words)) {
    if (
      !nonEmptyString(word) ||
      !isRecord(definition) ||
      !hasExactKeys(definition, ['roles', 'bindings']) ||
      !Array.isArray(definition.roles) ||
      definition.roles.length === 0 ||
      !definition.roles.every((role) => nonEmptyString(role) && ROLE_SET.has(role)) ||
      !isRecord(definition.bindings)
    ) {
      errors.push(`catalog word "${word}" is invalid`);
      continue;
    }
    for (const [name, binding] of Object.entries(definition.bindings)) {
      if (
        !nonEmptyString(name) ||
        !isRecord(binding) ||
        !hasExactKeys(binding, ['sources', 'required']) ||
        !Array.isArray(binding.sources) ||
        binding.sources.length === 0 ||
        !binding.sources.every(
          (source) => nonEmptyString(source) && BINDING_KIND_SET.has(source),
        ) ||
        (binding.required !== undefined && typeof binding.required !== 'boolean')
      ) {
        errors.push(`catalog word "${word}" binding "${name}" is invalid`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function parseDependencies(
  value: unknown,
  nodeId: string,
  path: string,
  issues: SurfaceValidationIssue[],
): SurfaceDependency[] | undefined {
  if (!Array.isArray(value)) {
    issue(issues, 'dependency-invalid', nodeId, path, 'dependencies must be an array');
    return undefined;
  }
  const parsed: SurfaceDependency[] = [];
  for (const [index, candidate] of value.entries()) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['kind', 'subject', 'version', 'paths']) ||
      !nonEmptyString(candidate.kind) ||
      !DEPENDENCY_KIND_SET.has(candidate.kind) ||
      !nonEmptyString(candidate.subject) ||
      !nonEmptyString(candidate.version) ||
      (candidate.paths !== undefined &&
        (!Array.isArray(candidate.paths) || !candidate.paths.every(nonEmptyString)))
    ) {
      issue(
        issues,
        'dependency-invalid',
        nodeId,
        `${path}.dependencies[${index}]`,
        'dependency must contain only a supported kind, subject, version and string paths',
      );
      continue;
    }
    parsed.push({
      kind: candidate.kind as SurfaceDependency['kind'],
      subject: candidate.subject,
      version: candidate.version,
      ...(candidate.paths === undefined
        ? {}
        : { paths: [...new Set(candidate.paths as string[])].sort() }),
    });
  }
  return parsed;
}

function parseProvenance(
  value: unknown,
  nodeId: string,
  path: string,
  issues: SurfaceValidationIssue[],
): SurfaceProvenance[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issue(issues, 'node-invalid', nodeId, path, 'provenance must be a non-empty array');
    return undefined;
  }
  const parsed: SurfaceProvenance[] = [];
  for (const [index, candidate] of value.entries()) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['kind', 'ref', 'model']) ||
      !nonEmptyString(candidate.kind) ||
      !PROVENANCE_KIND_SET.has(candidate.kind) ||
      !nonEmptyString(candidate.ref) ||
      (candidate.model !== undefined && !nonEmptyString(candidate.model))
    ) {
      issue(
        issues,
        'node-invalid',
        nodeId,
        `${path}.provenance[${index}]`,
        'provenance is invalid',
      );
      continue;
    }
    parsed.push({
      kind: candidate.kind as SurfaceProvenance['kind'],
      ref: candidate.ref,
      ...(candidate.model === undefined ? {} : { model: candidate.model as string }),
    });
  }
  return parsed.length === value.length ? parsed : undefined;
}

function parseBinding(
  value: unknown,
  nodeId: string,
  path: string,
  inRepeat: boolean,
  issues: SurfaceValidationIssue[],
): SurfaceBinding | undefined {
  if (!isRecord(value) || !nonEmptyString(value.kind)) {
    issue(issues, 'binding-invalid', nodeId, path, 'binding must be a reference object');
    return undefined;
  }
  if (value.kind === 'property') {
    if (
      !hasExactKeys(value, ['kind', 'subject', 'path']) ||
      !nonEmptyString(value.subject) ||
      !nonEmptyString(value.path)
    ) {
      issue(issues, 'binding-invalid', nodeId, path, 'property binding is invalid');
      return undefined;
    }
    return { kind: 'property', subject: value.subject, path: value.path };
  }
  if (value.kind === 'actions' || value.kind === 'links' || value.kind === 'entities') {
    if (!hasExactKeys(value, ['kind', 'subject']) || !nonEmptyString(value.subject)) {
      issue(issues, 'binding-invalid', nodeId, path, 'structural binding is invalid');
      return undefined;
    }
    return { kind: value.kind, subject: value.subject };
  }
  if (value.kind === 'item') {
    if (!inRepeat || !hasExactKeys(value, ['kind', 'path']) || !nonEmptyString(value.path)) {
      issue(issues, 'binding-invalid', nodeId, path, 'item binding is valid only in a repeat');
      return undefined;
    }
    return { kind: 'item', path: value.path };
  }
  issue(issues, 'binding-invalid', nodeId, path, `unsupported binding kind "${value.kind}"`);
  return undefined;
}

function bindingPath(binding: Exclude<SurfaceBinding, { kind: 'item' }>): string {
  return binding.kind === 'property' ? binding.path : `$${binding.kind}`;
}

function hasEntityDependency(
  dependencies: readonly SurfaceDependency[],
  binding: Exclude<SurfaceBinding, { kind: 'item' }>,
): boolean {
  const requiredPath = bindingPath(binding);
  return dependencies.some(
    (dependency) =>
      dependency.kind === 'entity' &&
      dependency.subject === binding.subject &&
      dependency.paths?.includes(requiredPath) === true,
  );
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function normalizedDependencies(dependencies: readonly SurfaceDependency[]): SurfaceDependency[] {
  return [...dependencies]
    .map((dependency) => ({
      kind: dependency.kind,
      subject: dependency.subject,
      version: dependency.version,
      ...(dependency.paths === undefined ? {} : { paths: [...new Set(dependency.paths)].sort() }),
    }))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function normalizedBindings(
  bindings: Readonly<Record<string, SurfaceBinding>>,
): Record<string, SurfaceBinding> {
  return Object.fromEntries(
    Object.entries(bindings).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeNode(node: SurfaceNode): SurfaceNode {
  const base = {
    id: node.id,
    role: node.role,
    dependencies: normalizedDependencies(node.dependencies),
    provenance: node.provenance.map((entry) => ({ ...entry })),
  };
  switch (node.kind) {
    case 'layout':
      return {
        kind: 'layout',
        ...base,
        layout: node.layout,
        children: node.children.map(normalizeNode),
      };
    case 'slot':
      return { kind: 'slot', ...base, name: node.name, child: normalizeNode(node.child) };
    case 'repeat':
      return {
        kind: 'repeat',
        ...base,
        source: { ...node.source },
        item: normalizeNode(node.item),
      };
    case 'word':
      return {
        kind: 'word',
        ...base,
        word: node.word,
        bindings: normalizedBindings(node.bindings),
      };
    case 'diagnostic':
      return {
        kind: 'diagnostic',
        ...base,
        code: node.code,
        ...(node.failedNodeId === undefined ? {} : { failedNodeId: node.failedNodeId }),
      };
  }
}

export function normalizeSurfaceTree(surface: SurfaceTree): SurfaceTree {
  return { schemaVersion: SURFACE_SCHEMA_VERSION, root: normalizeNode(surface.root) };
}

interface ValidationContext {
  catalog: SurfaceCatalog;
  issues: SurfaceValidationIssue[];
  nodeIds: Set<string>;
  ancestors: WeakSet<object>;
}

function validateNode(
  value: unknown,
  path: string,
  inRepeat: boolean,
  context: ValidationContext,
): SurfaceNode {
  const fallbackId = isRecord(value) && nonEmptyString(value.id) ? value.id : path;
  if (!isRecord(value)) {
    issue(context.issues, 'node-invalid', fallbackId, path, 'node must be an object');
    return diagnosticNode(path, 'node-invalid', fallbackId);
  }
  if (context.ancestors.has(value)) {
    issue(context.issues, 'node-invalid', fallbackId, path, 'surface must be acyclic');
    return diagnosticNode(path, 'node-invalid', fallbackId);
  }

  const localIssues: SurfaceValidationIssue[] = [];
  const nodeId = nonEmptyString(value.id) ? value.id : fallbackId;
  if (
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.kind) ||
    !ROLE_SET.has(String(value.role))
  ) {
    issue(localIssues, 'node-invalid', nodeId, path, 'node id, kind or semantic role is invalid');
  }
  if (context.nodeIds.has(nodeId)) {
    issue(localIssues, 'node-id-duplicate', nodeId, path, 'node id must be unique');
  }
  context.nodeIds.add(nodeId);

  const dependencies = parseDependencies(value.dependencies, nodeId, path, localIssues);
  const provenance = parseProvenance(value.provenance, nodeId, path, localIssues);
  if (localIssues.length > 0 || dependencies === undefined || provenance === undefined) {
    context.issues.push(...localIssues);
    return diagnosticNode(path, localIssues[0]?.code ?? 'node-invalid', nodeId);
  }

  const role = value.role as SemanticRegionRole;
  const base = { id: nodeId, role, dependencies, provenance };
  context.ancestors.add(value);
  let result: SurfaceNode;

  if (value.kind === 'layout') {
    if (
      !hasExactKeys(value, [
        'kind',
        'id',
        'role',
        'layout',
        'children',
        'dependencies',
        'provenance',
      ]) ||
      !nonEmptyString(value.layout) ||
      !LAYOUT_SET.has(value.layout) ||
      !Array.isArray(value.children)
    ) {
      issue(localIssues, 'node-invalid', nodeId, path, 'layout node is invalid');
      result = diagnosticNode(path, 'node-invalid', nodeId);
    } else {
      result = {
        kind: 'layout',
        ...base,
        layout: value.layout as SurfaceLayout,
        children: value.children.map((child, index) =>
          validateNode(child, `${path}.children[${index}]`, inRepeat, context),
        ),
      };
    }
  } else if (value.kind === 'slot') {
    if (
      !hasExactKeys(value, ['kind', 'id', 'role', 'name', 'child', 'dependencies', 'provenance']) ||
      !nonEmptyString(value.name) ||
      value.child === undefined
    ) {
      issue(localIssues, 'node-invalid', nodeId, path, 'slot node is invalid');
      result = diagnosticNode(path, 'node-invalid', nodeId);
    } else {
      result = {
        kind: 'slot',
        ...base,
        name: value.name,
        child: validateNode(value.child, `${path}.child`, inRepeat, context),
      };
    }
  } else if (value.kind === 'repeat') {
    const source = parseBinding(value.source, nodeId, `${path}.source`, inRepeat, localIssues);
    if (
      !hasExactKeys(value, [
        'kind',
        'id',
        'role',
        'source',
        'item',
        'dependencies',
        'provenance',
      ]) ||
      source?.kind !== 'entities' ||
      value.item === undefined
    ) {
      issue(localIssues, 'node-invalid', nodeId, path, 'repeat node is invalid');
      result = diagnosticNode(path, 'node-invalid', nodeId);
    } else if (!hasEntityDependency(dependencies, source)) {
      issue(localIssues, 'dependency-missing', nodeId, path, 'repeat source has no dependency');
      result = diagnosticNode(path, 'dependency-missing', nodeId);
    } else {
      result = {
        kind: 'repeat',
        ...base,
        source,
        item: validateNode(value.item, `${path}.item`, true, context),
      };
    }
  } else if (value.kind === 'word') {
    const definition = nonEmptyString(value.word) ? context.catalog.words[value.word] : undefined;
    if (
      !hasExactKeys(value, [
        'kind',
        'id',
        'role',
        'word',
        'bindings',
        'dependencies',
        'provenance',
      ]) ||
      !nonEmptyString(value.word) ||
      !isRecord(value.bindings)
    ) {
      issue(localIssues, 'node-invalid', nodeId, path, 'word node is invalid');
    } else if (definition === undefined) {
      issue(localIssues, 'unknown-word', nodeId, path, `word "${value.word}" is not in catalog`);
    } else {
      if (!definition.roles.includes(role)) {
        issue(localIssues, 'word-role-invalid', nodeId, path, 'word does not support this role');
      }
      const bindings: Record<string, SurfaceBinding> = {};
      for (const [name, bindingValue] of Object.entries(value.bindings)) {
        const binding = parseBinding(
          bindingValue,
          nodeId,
          `${path}.bindings.${name}`,
          inRepeat,
          localIssues,
        );
        const bindingDefinition = definition.bindings[name];
        if (bindingDefinition === undefined) {
          issue(localIssues, 'unknown-binding', nodeId, path, `binding "${name}" is not declared`);
        }
        if (binding !== undefined) {
          bindings[name] = binding;
          if (
            bindingDefinition !== undefined &&
            !bindingDefinition.sources.includes(binding.kind)
          ) {
            issue(
              localIssues,
              'binding-source-invalid',
              nodeId,
              path,
              `binding "${name}" has an unsupported source`,
            );
          }
          if (binding.kind !== 'item' && !hasEntityDependency(dependencies, binding)) {
            issue(
              localIssues,
              'dependency-missing',
              nodeId,
              path,
              `binding "${name}" has no entity dependency`,
            );
          }
        }
      }
      for (const [name, bindingDefinition] of Object.entries(definition.bindings)) {
        if (bindingDefinition.required === true && bindings[name] === undefined) {
          issue(
            localIssues,
            'required-binding-missing',
            nodeId,
            path,
            `required binding "${name}" is missing`,
          );
        }
      }
      const hasCatalogDependency = dependencies.some(
        (dependency) =>
          dependency.kind === 'catalog' &&
          dependency.subject === context.catalog.id &&
          dependency.version === context.catalog.version,
      );
      if (!hasCatalogDependency) {
        issue(
          localIssues,
          'catalog-dependency-invalid',
          nodeId,
          path,
          'word catalog dependency is missing or stale',
        );
      }
      if (localIssues.length === 0) {
        result = { kind: 'word', ...base, word: value.word, bindings };
      }
    }
    result ??= diagnosticNode(path, localIssues[0]?.code ?? 'node-invalid', nodeId);
  } else if (value.kind === 'diagnostic') {
    if (
      !hasExactKeys(value, [
        'kind',
        'id',
        'role',
        'code',
        'failedNodeId',
        'dependencies',
        'provenance',
      ]) ||
      role !== 'diagnostic' ||
      !nonEmptyString(value.code) ||
      (value.failedNodeId !== undefined && !nonEmptyString(value.failedNodeId))
    ) {
      issue(localIssues, 'node-invalid', nodeId, path, 'diagnostic node is invalid');
      result = diagnosticNode(path, 'node-invalid', nodeId);
    } else {
      result = {
        kind: 'diagnostic',
        ...base,
        code: value.code,
        ...(value.failedNodeId === undefined ? {} : { failedNodeId: value.failedNodeId as string }),
      };
    }
  } else {
    issue(localIssues, 'node-invalid', nodeId, path, 'node kind is unsupported');
    result = diagnosticNode(path, 'node-invalid', nodeId);
  }

  context.ancestors.delete(value);
  context.issues.push(...localIssues);
  return result;
}

/** Keep structural parents and verified siblings; replace only rejected subtrees. */
export function validateSurfaceTree(
  value: unknown,
  catalog: SurfaceCatalog,
): SurfaceValidationResult {
  const issues: SurfaceValidationIssue[] = [];
  let root: SurfaceNode;
  const catalogValidation = validateSurfaceCatalog(catalog);
  if (!catalogValidation.valid) {
    issue(issues, 'catalog-invalid', 'root', '$', catalogValidation.errors.join('; '));
    root = diagnosticNode('root', 'catalog-invalid', 'root');
  } else if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'root']) ||
    value.schemaVersion !== SURFACE_SCHEMA_VERSION
  ) {
    issue(issues, 'surface-invalid', 'root', '$', 'surface schema or envelope is invalid');
    root = diagnosticNode('root', 'surface-invalid', 'root');
  } else {
    root = validateNode(value.root, 'root', false, {
      catalog,
      issues,
      nodeIds: new Set(),
      ancestors: new WeakSet(),
    });
  }
  return {
    valid: issues.length === 0,
    surface: normalizeSurfaceTree({ schemaVersion: SURFACE_SCHEMA_VERSION, root }),
    issues,
  };
}

export function serializeSurfaceTree(surface: SurfaceTree): string {
  return canonicalJson(normalizeSurfaceTree(surface));
}

export function restoreSurfaceTree(
  serialized: string,
  catalog: SurfaceCatalog,
): SurfaceValidationResult {
  try {
    return validateSurfaceTree(JSON.parse(serialized) as unknown, catalog);
  } catch {
    const issues: SurfaceValidationIssue[] = [];
    issue(issues, 'serialization-invalid', 'root', '$', 'serialized surface is invalid JSON');
    return {
      valid: false,
      surface: {
        schemaVersion: SURFACE_SCHEMA_VERSION,
        root: diagnosticNode('root', 'serialization-invalid', 'root'),
      },
      issues,
    };
  }
}

/** Stable cross-runtime identity; not a security digest. */
export function hashSurfaceTree(surface: SurfaceTree): string {
  const serialized = serializeSurfaceTree(surface);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

function readPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function scalarPropertyPaths(value: unknown, prefix: string): string[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${prefix}.${key}`;
    return isRecord(child) ? scalarPropertyPaths(child, path) : [path];
  });
}

function catalogDependency(catalog: SurfaceCatalog): SurfaceDependency {
  return { kind: 'catalog', subject: catalog.id, version: catalog.version };
}

function entityDependencyFor(
  subject: string,
  version: string,
  binding: Exclude<SurfaceBinding, { kind: 'item' }>,
): SurfaceDependency {
  return { kind: 'entity', subject, version, paths: [bindingPath(binding)] };
}

function selectCatalogWord(
  catalog: SurfaceCatalog,
  role: SemanticRegionRole,
  source: SurfaceBindingKind,
): { word: string; input: string } | undefined {
  for (const [word, definition] of Object.entries(catalog.words).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!definition.roles.includes(role)) continue;
    const compatible = Object.entries(definition.bindings)
      .filter(([, binding]) => binding.sources.includes(source))
      .sort(([left], [right]) => left.localeCompare(right));
    const required = Object.entries(definition.bindings).filter(([, binding]) => binding.required);
    if (compatible.length > 0 && required.every(([name]) => name === compatible[0]![0])) {
      return { word, input: compatible[0]![0] };
    }
  }
  return undefined;
}

function genericProvenance(ref: string): SurfaceProvenance[] {
  return [{ kind: 'generic-fallback', ref }];
}

function genericWord(
  id: string,
  role: SemanticRegionRole,
  binding: SurfaceBinding,
  catalog: SurfaceCatalog,
  entityVersion: string,
  provenanceRef: string,
): SurfaceNode {
  const selection = selectCatalogWord(catalog, role, binding.kind);
  if (selection === undefined) return diagnosticNode(id, 'catalog-word-unavailable', id);
  const dependencies = [catalogDependency(catalog)];
  if (binding.kind !== 'item') {
    dependencies.push(entityDependencyFor(binding.subject, entityVersion, binding));
  }
  return {
    kind: 'word',
    id,
    role,
    word: selection.word,
    bindings: { [selection.input]: binding },
    dependencies,
    provenance: genericProvenance(provenanceRef),
  };
}

function genericSlot(index: number, role: SemanticRegionRole, child: SurfaceNode): SurfaceSlotNode {
  return {
    kind: 'slot',
    id: `region-${index}`,
    role,
    name: `${role}-${index}`,
    child,
    dependencies: normalizedDependencies(child.dependencies),
    provenance: child.provenance.map((entry) => ({ ...entry })),
  };
}

/**
 * Mechanical last-resort planner. It consumes explicit semantic paths and generic Siren structure;
 * vocabulary selection is catalog-driven and never branches on domain class, rel or action names.
 */
export function planGenericSurface(
  subject: string,
  entity: SirenEntity,
  catalog: SurfaceCatalog,
  options: GenericSurfaceOptions,
): SurfaceTree {
  const catalogValidation = validateSurfaceCatalog(catalog);
  if (
    !nonEmptyString(subject) ||
    !nonEmptyString(options.entityVersion) ||
    !catalogValidation.valid
  ) {
    return {
      schemaVersion: SURFACE_SCHEMA_VERSION,
      root: diagnosticNode(
        'root',
        catalogValidation.valid ? 'generic-input-invalid' : 'catalog-invalid',
        'root',
      ),
    };
  }
  const provenanceRef = options.provenanceRef ?? 'generic-fallback';
  const plannedPaths = new Set<string>();
  const regions: Array<{ role: SemanticRegionRole; binding: SurfaceBinding }> = [];
  const hints = Object.entries(options.semanticHints ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  for (const [path, role] of hints) {
    if (
      (role === 'identity' ||
        role === 'status' ||
        role === 'primary-content' ||
        role === 'metadata') &&
      readPath(entity, path) !== undefined
    ) {
      regions.push({ role, binding: { kind: 'property', subject, path } });
      plannedPaths.add(path);
    }
  }

  if (!regions.some((region) => region.role === 'identity')) {
    const path = 'properties.rel';
    if (readPath(entity, path) !== undefined) {
      regions.unshift({ role: 'identity', binding: { kind: 'property', subject, path } });
      plannedPaths.add(path);
    }
  }
  if (!regions.some((region) => region.role === 'status')) {
    const path = 'properties.node';
    if (readPath(entity, path) !== undefined) {
      regions.push({ role: 'status', binding: { kind: 'property', subject, path } });
      plannedPaths.add(path);
    }
  }

  for (const path of scalarPropertyPaths(entity.properties.fields, 'properties.fields').sort()) {
    if (!plannedPaths.has(path)) {
      regions.push({ role: 'primary-content', binding: { kind: 'property', subject, path } });
      plannedPaths.add(path);
    }
  }
  for (const path of scalarPropertyPaths(entity.properties, 'properties').sort()) {
    if (!plannedPaths.has(path) && !path.startsWith('properties.fields.')) {
      regions.push({ role: 'metadata', binding: { kind: 'property', subject, path } });
      plannedPaths.add(path);
    }
  }
  if (entity.actions.length > 0) {
    regions.push({ role: 'actions', binding: { kind: 'actions', subject } });
  }
  if (entity.links.length > 0) {
    regions.push({ role: 'relation', binding: { kind: 'links', subject } });
  }

  const children = regions.map(({ role, binding }, index) =>
    genericSlot(
      index,
      role,
      genericWord(`word-${index}`, role, binding, catalog, options.entityVersion, provenanceRef),
    ),
  );

  if (entity.entities !== undefined) {
    const repeatIndex = children.length;
    const source: Extract<SurfaceBinding, { kind: 'entities' }> = { kind: 'entities', subject };
    const item = genericWord(
      `word-${repeatIndex}-item`,
      'identity',
      { kind: 'item', path: 'properties.rel' },
      catalog,
      options.entityVersion,
      provenanceRef,
    );
    const repeat: SurfaceRepeatNode = {
      kind: 'repeat',
      id: `repeat-${repeatIndex}`,
      role: 'relation',
      source,
      item,
      dependencies: [entityDependencyFor(subject, options.entityVersion, source)],
      provenance: genericProvenance(provenanceRef),
    };
    children.push(genericSlot(repeatIndex, 'relation', repeat));
  }

  const root: SurfaceLayoutNode = {
    kind: 'layout',
    id: 'root',
    role: 'primary-content',
    layout: 'stack',
    children:
      children.length > 0 ? children : [diagnosticNode('empty', 'generic-content-unavailable')],
    dependencies: normalizedDependencies(children.flatMap((child) => child.dependencies)),
    provenance: genericProvenance(provenanceRef),
  };
  return normalizeSurfaceTree({ schemaVersion: SURFACE_SCHEMA_VERSION, root });
}
