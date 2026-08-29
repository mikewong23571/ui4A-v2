/**
 * Surface 校验:catalog 形状校验、节点递归校验(拒绝子树局部替换为诊断节点)、
 * 序列化还原(JSON → 校验管线)。Keep structural parents and verified siblings;
 * replace only rejected subtrees.
 */
import {
  diagnosticNode,
  hasEntityDependency,
  hasExactKeys,
  isRecord,
  issue,
  nonEmptyString,
} from './internal';
import { normalizeSurfaceTree } from './normalize';
import {
  SEMANTIC_REGION_ROLES,
  SURFACE_SCHEMA_VERSION,
  type SemanticRegionRole,
  type SurfaceBinding,
  type SurfaceCatalog,
  type SurfaceCatalogValidationResult,
  type SurfaceDependency,
  type SurfaceLayout,
  type SurfaceNode,
  type SurfaceProvenance,
  type SurfaceValidationIssue,
  type SurfaceValidationResult,
} from './types';

const ROLE_SET = new Set<string>(SEMANTIC_REGION_ROLES);
const LAYOUT_SET = new Set<string>(['stack', 'grid', 'inline']);
const PROVENANCE_KIND_SET = new Set<string>([
  'application-recipe',
  'presentation-agent',
  'generic-fallback',
  'human-patch',
  'composition-declaration',
  'validator',
]);
const DEPENDENCY_KIND_SET = new Set<string>(['entity', 'definition', 'catalog']);
const BINDING_KIND_SET = new Set<string>(['property', 'actions', 'links', 'entities', 'item']);

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
      !hasExactKeys(definition, ['roles', 'bindings', 'pattern']) ||
      !Array.isArray(definition.roles) ||
      definition.roles.length === 0 ||
      !definition.roles.every((role) => nonEmptyString(role) && ROLE_SET.has(role)) ||
      !isRecord(definition.bindings) ||
      (definition.pattern !== undefined &&
        definition.pattern !== 'member-link' &&
        definition.pattern !== 'member-card' &&
        definition.pattern !== 'member-table' &&
        definition.pattern !== 'collection-filters' &&
        definition.pattern !== 'page-links')
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
