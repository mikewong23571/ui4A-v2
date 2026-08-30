/**
 * Generic fallback 规划器:机械兜底——只消费显式语义路径与通用 Siren 结构;
 * 词汇选择由 catalog 驱动,绝不按 domain class、rel 或 action 名分支。
 */
import type { SirenEntity } from '../../contract/siren/index';
import { parseCognitiveSemanticsProjection } from '../../contract/cognitive-semantics';
import { assembleSurfaceRegions } from '../compose/compose';
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
  genericMemberDensity,
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
  type SurfaceCatalogWord,
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

function cognitiveTraitsOf(value: unknown) {
  if (!isRecord(value) || value.version === undefined) return undefined;
  const cognitiveProjection = Object.fromEntries(
    ['version', 'traits', 'groupRole', 'priority', 'emptyMeaning', 'fields'].flatMap((key) =>
      key in value ? [[key, value[key]] as const] : [],
    ),
  );
  return parseCognitiveSemanticsProjection(cognitiveProjection)?.traits;
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
    // Pattern 词(member-* / collection-*)只经 findPattern 通道选择(repeat 成员
    // 词与集合查询词),绝不充当通用字段词——否则按名字序劫持同角色的字段区域。
    if (definition.pattern !== undefined) continue;
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
    const path = ['properties.identity', 'properties.title', 'properties.rel'].find(
      (candidate) => readPath(entity, candidate) !== undefined,
    );
    if (path !== undefined) {
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
    const excludedMembers = new Set(options.excludedMemberRels ?? []);
    const itemIdentityPath =
      entity.entities.length > 0 &&
      entity.entities.every((member) => readPath(member, 'properties.identity') !== undefined)
        ? 'properties.identity'
        : 'properties.rel';
    // T33 D50:成员携带已声明动作(纯结构判定,零 class/rel 分支)→ 决策卡词条;
    // 否则维持导航卡片(member-link)。密度贯通:region 声明 density='table' 时,
    // 携带动作的成员选 member-table pattern;目录缺该 pattern 时回退决策卡
    // (回退本身也是通用 pattern 查找,零实体特判);缺省/'card' 行为完全不变。
    const membersDeclareActions = entity.entities.some((member) => member.actions.length > 0);
    const findPattern = (pattern: NonNullable<SurfaceCatalogWord['pattern']>) =>
      Object.entries(catalog.words).find(([, definition]) => definition.pattern === pattern);
    const density = genericMemberDensity(
      options.density,
      cognitiveTraitsOf(entity.properties.presentation),
    );
    const memberTable =
      density === 'table' && membersDeclareActions
        ? (findPattern('member-table') ?? findPattern('member-card'))
        : undefined;
    const memberCard =
      density !== 'table' && membersDeclareActions ? findPattern('member-card') : undefined;
    const memberDecision = memberTable ?? memberCard;
    const memberLink = findPattern('member-link');
    // T35 F-21:成员状态优先取节点标题(任务语),成员缺 title 时回退 node 名。
    const itemStatusPath =
      entity.entities.length > 0 &&
      entity.entities.every((member) => readPath(member, 'properties.title') !== undefined)
        ? 'properties.title'
        : 'properties.status';
    const item: SurfaceNode =
      memberDecision !== undefined
        ? {
            kind: 'word',
            id: `word-${repeatIndex}-item`,
            role: 'identity',
            word: memberDecision[0],
            bindings: {
              label: { kind: 'item', path: itemIdentityPath },
              rel: { kind: 'item', path: 'properties.rel' },
              status: { kind: 'item', path: itemStatusPath },
              detail: { kind: 'item', path: 'properties.resume' },
              actions: { kind: 'item', path: 'actions' },
              guardResults: { kind: 'item', path: 'guard-results' },
              fields: { kind: 'item', path: 'properties.fields' },
              // T38 FR4:概览显示 hint 携带——词条目录声明 presentations 绑定时,
              // 规划器供给成员呈现元数据(properties.presentation.fields,声明序 +
              // title + overview)。未声明的成员词(如 member-card)零新绑定。
              ...(memberDecision[1].bindings.presentations === undefined
                ? {}
                : {
                    presentations: {
                      kind: 'item' as const,
                      path: 'properties.presentation.fields',
                    },
                  }),
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
      ...(excludedMembers.size === 0 ? {} : { exclude: [...excludedMembers].sort() }),
      item,
      dependencies: [entityDependencyFor(subject, options.entityVersion, source)],
      provenance: genericProvenance(provenanceRef),
    };
    // T38 FR5:集合查询词汇按目录 pattern 声明入树(零实体特判)——过滤词仅在
    // 声明维度(properties.presentation.filters)在场时规划;分页词随 repeat
    // 规划,渲染层只呈现声明的 next/prev 链接(无声明链接 → 渲染为空,零零件;
    // 服务端组合面从全量实体规划,无分页链接也需词位在场才能消费客户端分页读)。
    // 目录未声明 pattern → relation 槽形状与历史版本完全一致。
    const filterDeclarations = readPath(entity, 'properties.presentation.filters');
    const declareFilters = Array.isArray(filterDeclarations) && filterDeclarations.length > 0;
    const filtersPattern = declareFilters ? findPattern('collection-filters') : undefined;
    const pageLinksPattern = findPattern('page-links');
    const emptyMeaning = readPath(entity, 'properties.presentation.emptyMeaning');
    const emptyStatePattern =
      entity.entities.every((member) => {
        const rel = readPath(member, 'properties.rel');
        return typeof rel === 'string' && excludedMembers.has(rel);
      }) && nonEmptyString(emptyMeaning)
        ? findPattern('empty-state')
        : undefined;
    let relationChild: SurfaceNode = repeat;
    if (
      filtersPattern !== undefined ||
      pageLinksPattern !== undefined ||
      emptyStatePattern !== undefined
    ) {
      const parts: SurfaceNode[] = [];
      if (filtersPattern !== undefined) {
        const declarations: Extract<SurfaceBinding, { kind: 'property' }> = {
          kind: 'property',
          subject,
          path: 'properties.presentation.filters',
        };
        parts.push({
          kind: 'word',
          id: `word-${repeatIndex}-filters`,
          role: 'relation',
          word: filtersPattern[0],
          // 过滤词的 links 绑定按目录声明供给(当前过滤状态住合同 self 链接,
          // 人机同门;未声明该绑定的目录词只吃声明维度)。
          bindings: {
            declarations,
            ...(filtersPattern[1].bindings.links === undefined
              ? {}
              : { links: { kind: 'links', subject } as const }),
          },
          dependencies: [
            catalogDependency(catalog),
            entityDependencyFor(subject, options.entityVersion, declarations),
            ...(filtersPattern[1].bindings.links === undefined
              ? []
              : [
                  entityDependencyFor(subject, options.entityVersion, {
                    kind: 'links',
                    subject,
                  } as const),
                ]),
          ],
          provenance: genericProvenance(provenanceRef),
        });
      }
      if (emptyStatePattern !== undefined) {
        const meaning: Extract<SurfaceBinding, { kind: 'property' }> = {
          kind: 'property',
          subject,
          path: 'properties.presentation.emptyMeaning',
        };
        parts.push({
          kind: 'word',
          id: `word-${repeatIndex}-empty-state`,
          role: 'primary-content',
          word: emptyStatePattern[0],
          bindings: { meaning },
          dependencies: [
            catalogDependency(catalog),
            entityDependencyFor(subject, options.entityVersion, meaning),
          ],
          provenance: genericProvenance(provenanceRef),
        });
      }
      parts.push(repeat);
      if (pageLinksPattern !== undefined) {
        const links: Extract<SurfaceBinding, { kind: 'links' }> = { kind: 'links', subject };
        parts.push({
          kind: 'word',
          id: `word-${repeatIndex}-page-links`,
          role: 'relation',
          word: pageLinksPattern[0],
          bindings: { links },
          dependencies: [
            catalogDependency(catalog),
            entityDependencyFor(subject, options.entityVersion, links),
          ],
          provenance: genericProvenance(provenanceRef),
        });
      }
      relationChild = {
        kind: 'layout',
        id: `relation-${repeatIndex}`,
        role: 'relation',
        layout: 'stack',
        children: parts,
        dependencies: normalizedDependencies(parts.flatMap((child) => child.dependencies)),
        provenance: genericProvenance(provenanceRef),
      };
    }
    children.push(genericSlot(repeatIndex, 'relation', relationChild));
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
