/**
 * Generic fallback 规划器:机械兜底——只消费显式语义路径与通用 Siren 结构;
 * 词汇选择由 catalog 驱动,绝不按 domain class、rel 或 action 名分支。
 */
import type { SirenEntity } from '../../contract/siren/index';
import { assembleSurfaceRegions } from '../compose';
import {
  bindingPath,
  diagnosticNode,
  isRecord,
  nonEmptyString,
  normalizedDependencies,
} from './internal';
import { normalizeSurfaceTree } from './normalize';
import {
  GENERIC_ROLE_ORDER,
  selectGenericFieldCandidates,
  type GenericFieldCandidate,
} from './intent';
import { validateSurfaceCatalog } from './validate';
import {
  SURFACE_SCHEMA_VERSION,
  type GenericSurfaceOptions,
  type SemanticRegionRole,
  type SurfaceBinding,
  type SurfaceBindingKind,
  type SurfaceCatalog,
  type SurfaceDependency,
  type SurfaceLayoutNode,
  type SurfaceNode,
  type SurfaceProvenance,
  type SurfaceRepeatNode,
  type SurfaceSlotNode,
  type SurfaceTree,
} from './types';

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

const GENERIC_STRUCTURAL_PROPERTY_PATHS = new Set([
  'properties.rel',
  'properties.node',
  'properties.title',
  'properties.identity',
  'properties.status',
  'properties.presentation',
  'properties.flow',
]);

/**
 * T35 F-06:簿记数值(count/delivered/limit/total)不进 fallback metadata 词——
 * 裸数字无信息量且与成员重复;按字段名判定(零 class 分支,特判滑梯红线),
 * 显式 presentation 声明路径不走 fallback,仍可恢复呈现。
 */
const GENERIC_BOOKKEEPING_PROPERTY_NAMES = new Set(['count', 'delivered', 'limit', 'total']);

function isGenericFieldRole(role: SemanticRegionRole): role is GenericFieldCandidate['role'] {
  return role !== 'actions' && role !== 'diagnostic';
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
    const supported = Object.entries(definition.bindings)
      .filter(([, binding]) => binding.sources.includes(source))
      .sort(([left], [right]) => left.localeCompare(right));
    const required = Object.entries(definition.bindings).filter(([, binding]) => binding.required);
    if (supported.length > 0 && required.every(([name]) => name === supported[0]![0])) {
      return { word, input: supported[0]![0] };
    }
  }
  return undefined;
}

function genericProvenance(ref: string): SurfaceProvenance[] {
  return [{ kind: 'generic-fallback', ref }];
}

function assembleGenericSubject(surface: SurfaceTree, provenanceRef: string): SurfaceTree {
  const provenance = genericProvenance(provenanceRef);
  return assembleSurfaceRegions([{ region: 'subject', surface, provenance }], { provenance });
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
  const provenanceRef = options.provenanceRef ?? 'generic-fallback';
  if (
    !nonEmptyString(subject) ||
    !nonEmptyString(options.entityVersion) ||
    !nonEmptyString(options.intent) ||
    !catalogValidation.valid
  ) {
    return assembleGenericSubject(
      {
        schemaVersion: SURFACE_SCHEMA_VERSION,
        root: diagnosticNode(
          'root',
          catalogValidation.valid ? 'generic-input-invalid' : 'catalog-invalid',
          'root',
        ),
      },
      provenanceRef,
    );
  }
  const plannedPaths = new Set<string>();
  const fieldCandidates: GenericFieldCandidate[] = [];
  const hints = Object.entries(options.semanticHints ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  for (const [path, role] of hints) {
    if (isGenericFieldRole(role) && readPath(entity, path) !== undefined) {
      fieldCandidates.push({ path, role });
      plannedPaths.add(path);
    }
  }

  if (!fieldCandidates.some((candidate) => candidate.role === 'identity')) {
    const path = 'properties.rel';
    if (readPath(entity, path) !== undefined) {
      fieldCandidates.push({ role: 'identity', path });
      plannedPaths.add(path);
    }
  }
  if (!fieldCandidates.some((candidate) => candidate.role === 'status')) {
    const path = 'properties.node';
    if (readPath(entity, path) !== undefined) {
      fieldCandidates.push({ role: 'status', path });
      plannedPaths.add(path);
    }
  }

  for (const path of scalarPropertyPaths(entity.properties.fields, 'properties.fields').sort()) {
    if (!plannedPaths.has(path)) {
      fieldCandidates.push({ role: 'primary-content', path });
      plannedPaths.add(path);
    }
  }
  for (const path of scalarPropertyPaths(entity.properties, 'properties').sort()) {
    if (
      !plannedPaths.has(path) &&
      !path.startsWith('properties.fields.') &&
      !path.startsWith('properties.presentation.') &&
      !GENERIC_STRUCTURAL_PROPERTY_PATHS.has(path)
    ) {
      // T35 F-06:簿记数值不进 fallback(GENERIC_BOOKKEEPING_PROPERTY_NAMES,按名判定)。
      if (GENERIC_BOOKKEEPING_PROPERTY_NAMES.has(path.replace('properties.', ''))) {
        plannedPaths.add(path);
        continue;
      }
      fieldCandidates.push({ role: 'metadata', path });
      plannedPaths.add(path);
    }
  }
  const regions: Array<{ role: SemanticRegionRole; binding: SurfaceBinding }> =
    selectGenericFieldCandidates(options.intent, fieldCandidates).map(({ path, role }) => ({
      role,
      binding: { kind: 'property', subject, path },
    }));
  if (entity.actions.length > 0) {
    regions.push({ role: 'actions', binding: { kind: 'actions', subject } });
  }
  if (entity.links.length > 0) {
    regions.push({ role: 'relation', binding: { kind: 'links', subject } });
  }

  regions.sort((left, right) => GENERIC_ROLE_ORDER[left.role] - GENERIC_ROLE_ORDER[right.role]);

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
    const itemIdentityPath =
      entity.entities.length > 0 &&
      entity.entities.every((member) => readPath(member, 'properties.identity') !== undefined)
        ? 'properties.identity'
        : 'properties.rel';
    // T33 D50:成员携带已声明动作(纯结构判定,零 class/rel 分支)→ 决策卡词条;
    // 否则维持导航卡片(member-link)。
    const membersDeclareActions = entity.entities.some((member) => member.actions.length > 0);
    const memberCard =
      membersDeclareActions === true
        ? Object.entries(catalog.words).find(
            ([, definition]) => definition.pattern === 'member-card',
          )
        : undefined;
    const memberLink = Object.entries(catalog.words).find(
      ([, definition]) => definition.pattern === 'member-link',
    );
    // T35 F-21:成员状态优先取节点标题(任务语),成员缺 title 时回退 node 名。
    const itemStatusPath =
      entity.entities.length > 0 &&
      entity.entities.every((member) => readPath(member, 'properties.title') !== undefined)
        ? 'properties.title'
        : 'properties.status';
    const item: SurfaceNode =
      memberCard !== undefined
        ? {
            kind: 'word',
            id: `word-${repeatIndex}-item`,
            role: 'identity',
            word: memberCard[0],
            bindings: {
              label: { kind: 'item', path: itemIdentityPath },
              rel: { kind: 'item', path: 'properties.rel' },
              status: { kind: 'item', path: itemStatusPath },
              detail: { kind: 'item', path: 'properties.resume' },
              actions: { kind: 'item', path: 'actions' },
              guardResults: { kind: 'item', path: 'guard-results' },
              fields: { kind: 'item', path: 'properties.fields' },
            },
            dependencies: [catalogDependency(catalog)],
            provenance: genericProvenance(provenanceRef),
          }
        : memberLink === undefined
          ? genericWord(
              `word-${repeatIndex}-item`,
              'identity',
              { kind: 'item', path: itemIdentityPath },
              catalog,
              options.entityVersion,
              provenanceRef,
            )
          : {
              kind: 'word',
              id: `word-${repeatIndex}-item`,
              role: 'identity',
              word: memberLink[0],
              bindings: {
                label: { kind: 'item', path: itemIdentityPath },
                rel: { kind: 'item', path: 'properties.rel' },
                status: { kind: 'item', path: itemStatusPath },
                detail: { kind: 'item', path: 'properties.resume' },
              },
              dependencies: [catalogDependency(catalog)],
              provenance: genericProvenance(provenanceRef),
            };
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
  return assembleGenericSubject(
    normalizeSurfaceTree({ schemaVersion: SURFACE_SCHEMA_VERSION, root }),
    provenanceRef,
  );
}
