'use client';
/**
 * BIOS 定义查看面(T4 Phase C;spec 架构决定 7):flow 定义的纯文本/表格视图;
 * T13 Phase A(spec 架构决定 1)在表格之上增只读拓扑图;T13 Phase B(spec
 * 架构决定 2)增版本历史区,Task 2 增两版对比(机械 diff)。
 *
 * - meta/flow:<name> 与 meta/self 共用(同一 flow-definition 投影形状):
 *   拓扑区(FlowTopologyView,只读 React Flow)+ 属性表 + 版本历史区(版本号/
 *   状态徽标/激活来源 + 两版对比;meta/self 无版本表,不出区)+ 节点表 + 动作表
 *   (name/to/guards/requires-confirmation/effect)+ 字段表——全部来自
 *   Siren 投影,零业务分支;
 * - 子实体按 class 各表其区:node-definition 进节点/动作/拓扑,
 *   definition-version 进版本历史区;两版对比的数据取自版本子实体
 *   properties.definition 内嵌全文(版本子实体有意无 href——href 会进
 *   agent 可导航候选),不新辟版本端点;
 * - 渲染零 AI(铁律 5):机械投影 + 机械 diff(引擎 definitionDiff 同一算法),
 *   不引入任何 AI/LLM 依赖。
 */
import { useState } from 'react';

import {
  definitionDiff,
  type FieldDefinition,
  type FlowDefinition,
  type SirenEntity,
} from '@ui4a/engine';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { DefinitionDiffView } from './diff-render';
import { FlowTopologyView } from './flow-topology-view';
import { MetaActions } from './renderers/common';

/** 按 class 标记选子实体(Siren 子实体惯例:节点/版本各表其区)。 */
function subEntitiesOf(entity: SirenEntity, marker: string): SirenEntity[] {
  return (entity.entities ?? []).filter((sub) => sub.class.includes(marker));
}

/** 动作声明投影的 fields 属性形状(action-definition 子实体)。 */
type ActionFields = FieldDefinition[] | undefined;

interface ActionRow {
  node: string;
  name: string;
  title: string;
  to: string;
  guards: string;
  confirmation: string;
  effect: string;
  fields: ActionFields;
}

/** 从 node-definition 子实体展平动作行(声明顺序即渲染顺序)。 */
function actionRows(entity: SirenEntity): ActionRow[] {
  const rows: ActionRow[] = [];
  for (const node of subEntitiesOf(entity, 'node-definition')) {
    for (const action of node.entities ?? []) {
      const props = action.properties as Record<string, unknown>;
      rows.push({
        node: String(node.properties.name ?? ''),
        name: String(props.name ?? ''),
        title: String(props.title ?? ''),
        to: props.to === undefined ? '' : String(props.to),
        guards: JSON.stringify(props.guards ?? []),
        confirmation:
          props['requires-confirmation'] === undefined
            ? ''
            : String(props['requires-confirmation']),
        effect: JSON.stringify(props.effect ?? []),
        fields: Array.isArray(props.fields) ? (props.fields as FieldDefinition[]) : undefined,
      });
    }
  }
  return rows;
}

/** 字段行(节点动作的字段声明:name/type/required/semantics)。 */
interface FieldRow {
  action: string;
  name: string;
  type: string;
  required: string;
  semantics: string;
}

function fieldRows(rows: readonly ActionRow[]): FieldRow[] {
  const fields: FieldRow[] = [];
  for (const row of rows) {
    for (const field of row.fields ?? []) {
      fields.push({
        action: `${row.node} / ${row.name}`,
        name: field.name,
        type: field.type,
        required: field.required === true ? '必填' : '',
        semantics: field.semantics ?? '',
      });
    }
  }
  return fields;
}

/** 属性表键值对(标量与一层数组;guards 列表按逗号连接)。 */
function propertyPairs(entity: SirenEntity, excluded: ReadonlySet<string>): [string, string][] {
  return Object.entries(entity.properties)
    .filter(([key]) => !excluded.has(key))
    .map(([key, value]) => {
      if (Array.isArray(value)) return [key, value.map(String).join(', ')];
      if (value !== null && typeof value === 'object') return [key, JSON.stringify(value)];
      return [key, String(value)];
    });
}

/** 版本历史行(definition-version 摘要子实体;版本序排列)。 */
interface VersionRow {
  version: number;
  status: string;
  /** 来源文本:种子 / 激活 <id> · 审批者(投影口径的展示映射,同 fieldRows 的「必填」)。 */
  source: string;
  /** 该版定义全文(投影 properties.definition 内嵌;两版对比的 diff 输入)。 */
  definition: FlowDefinition | undefined;
}

function versionRows(entity: SirenEntity): VersionRow[] {
  return subEntitiesOf(entity, 'definition-version')
    .map((sub) => {
      const props = sub.properties;
      // 断言理由:decided-by 由投影按 {actor, principal?} 形状写入;
      // definition 由投影内嵌该版 FlowDefinition 全文(版本子实体有意无 href,按版本取
      // 定义只走此内嵌通道,缺省即不可比对——不造数据)。
      const decidedBy = props['decided-by'] as { actor?: string; principal?: string } | undefined;
      const definition = props.definition as FlowDefinition | undefined;
      let source = '';
      if (props.source === 'definition-seeded') {
        source = '种子';
      } else if (props.source === 'definition-activated') {
        source = `激活 ${String(props.activation ?? '')}`;
        if (decidedBy !== undefined) {
          source += ` · ${decidedBy.actor ?? ''}${decidedBy.principal ? `(${decidedBy.principal})` : ''}`;
        }
      }
      return {
        version: Number(props.version ?? 0),
        status: String(props.status ?? ''),
        source,
        definition,
      };
    })
    .sort((a, b) => a.version - b.version);
}

/**
 * 两版对比(只读;T13 Phase B Task 2):两个下拉选基线/对比版本,机械 diff
 * 复用 DefinitionDiffView(added/deleted/updated 三视角,diff 计算即引擎
 * definitionDiff 同一 deep-object-diff 算法,零 AI)。同版或缺全文不比。
 */
function VersionCompare({ versions }: { versions: readonly VersionRow[] }) {
  const [base, setBase] = useState<number | undefined>(undefined);
  const [candidate, setCandidate] = useState<number | undefined>(undefined);
  const baseRow = versions.find((row) => row.version === base);
  const candidateRow = versions.find((row) => row.version === candidate);
  const diff =
    base !== undefined &&
    candidate !== undefined &&
    base !== candidate &&
    baseRow?.definition !== undefined &&
    candidateRow?.definition !== undefined
      ? definitionDiff(baseRow.definition, candidateRow.definition)
      : undefined;

  return (
    <div data-compare="versions" className="mt-3">
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">基线版本</span>
          <select
            aria-label="基线版本"
            data-compare="base"
            className="rounded-md border bg-background px-2 py-1"
            value={base ?? ''}
            onChange={(event) =>
              setBase(event.target.value === '' ? undefined : Number(event.target.value))
            }
          >
            <option value="">选择版本</option>
            {versions.map((row) => (
              <option key={row.version} value={row.version}>
                v{row.version}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">对比版本</span>
          <select
            aria-label="对比版本"
            data-compare="candidate"
            className="rounded-md border bg-background px-2 py-1"
            value={candidate ?? ''}
            onChange={(event) =>
              setCandidate(event.target.value === '' ? undefined : Number(event.target.value))
            }
          >
            <option value="">选择版本</option>
            {versions.map((row) => (
              <option key={row.version} value={row.version}>
                v{row.version}
              </option>
            ))}
          </select>
        </label>
      </div>
      {diff !== undefined && <DefinitionDiffView diff={diff} />}
    </div>
  );
}

export interface FlowDefinitionViewProps {
  rel: string;
  entity: SirenEntity;
  /** 定义平面 scope(动作提交经 /_meta/api/exec 携带;缺省与合同详情页同)。 */
  scope?: string;
  /** 动作 exec 成功后的重拉(事件溯源口径:投影总能由日志重算)。 */
  onChanged?: () => void;
  /** 友好路由保留返回导航；canonical shell 已接管页面导航。 */
  standalone?: boolean;
}

/** 定义查看(纯渲染;数据来自 /_meta/api/entity?rel=meta/flow:<name>|meta/self)。 */
export function FlowDefinitionView({
  rel,
  entity,
  scope,
  onChanged,
  standalone = true,
}: FlowDefinitionViewProps) {
  const properties = entity.properties;
  const heading =
    typeof properties.title === 'string' && properties.title !== ''
      ? properties.title
      : String(properties.name ?? rel);
  const rows = actionRows(entity);
  const nodes = subEntitiesOf(entity, 'node-definition');
  const versions = versionRows(entity);
  // 可比对版本 = 投影内嵌 definition 全文的版本行(缺全文不可比对,不造数据)。
  const comparableVersions = versions.filter((row) => row.definition !== undefined);
  const hasTopology =
    typeof properties.initial === 'string' &&
    (entity.entities ?? []).some((sub) => sub.class.includes('node-definition'));
  const excludedProperties = new Set(!standalone && versions.length > 0 ? ['status'] : []);

  return (
    <div>
      {standalone && (
        <nav className="mb-2 text-sm">
          <a href="/meta" data-nav="meta-back" className="text-primary hover:underline">
            ← 定义管理
          </a>
        </nav>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
      <p className="mt-1 text-xs text-muted-foreground">{rel}</p>

      {hasTopology && (
        <section aria-label="拓扑" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">拓扑</h2>
          <FlowTopologyView entity={entity} />
        </section>
      )}

      <section aria-label="属性" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">属性</h2>
        <div className="rounded-md border bg-card">
          <Table>
            <TableBody>
              {propertyPairs(entity, excludedProperties).map(([key, value]) => (
                <TableRow key={key}>
                  <th
                    scope="row"
                    className="px-3 py-2 text-left align-top font-normal whitespace-nowrap text-muted-foreground"
                  >
                    {key}
                  </th>
                  <TableCell className="px-3 py-2 break-all whitespace-normal">{value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {versions.length > 0 && (
        <section aria-label="版本历史" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">版本历史</h2>
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 text-muted-foreground">版本</TableHead>
                  <TableHead className="px-3 text-muted-foreground">状态</TableHead>
                  <TableHead className="px-3 text-muted-foreground">来源</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((row) => (
                  <TableRow key={row.version} data-version={row.version}>
                    <TableCell className="px-3 py-2">v{row.version}</TableCell>
                    <TableCell className="px-3 py-2">
                      <Badge variant={row.status === 'active' ? 'secondary' : 'outline'}>
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2">{row.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* 两版对比:≥2 版且全文内嵌才出入口(单版/无版本不比;缺全文不造数据)。 */}
          {comparableVersions.length >= 2 && <VersionCompare versions={comparableVersions} />}
        </section>
      )}

      <section aria-label="节点" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">节点({nodes.length})</h2>
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3 text-muted-foreground">节点</TableHead>
                <TableHead className="px-3 text-muted-foreground">标题</TableHead>
                <TableHead className="px-3 text-muted-foreground">动作数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nodes.map((node) => (
                <TableRow key={String(node.properties.name)}>
                  <TableCell className="px-3 py-2">{String(node.properties.name)}</TableCell>
                  <TableCell className="px-3 py-2">{String(node.properties.title ?? '')}</TableCell>
                  <TableCell className="px-3 py-2">{(node.entities ?? []).length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-label="动作" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">动作</h2>
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-3 text-muted-foreground">节点</TableHead>
                <TableHead className="px-3 text-muted-foreground">动作</TableHead>
                <TableHead className="px-3 text-muted-foreground">to</TableHead>
                <TableHead className="px-3 text-muted-foreground">guards</TableHead>
                <TableHead className="px-3 text-muted-foreground">确认</TableHead>
                <TableHead className="px-3 text-muted-foreground">effect</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.node}:${row.name}`}>
                  <TableCell className="px-3 py-2 align-top">{row.node}</TableCell>
                  <TableCell className="px-3 py-2 align-top">{row.name}</TableCell>
                  <TableCell className="px-3 py-2 align-top">{row.to}</TableCell>
                  <TableCell className="px-3 py-2 align-top break-all whitespace-normal">
                    {row.guards}
                  </TableCell>
                  <TableCell className="px-3 py-2 align-top">{row.confirmation}</TableCell>
                  <TableCell className="px-3 py-2 align-top break-all whitespace-normal">
                    {row.effect}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {fieldRows(rows).length > 0 && (
        <section aria-label="字段" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">字段</h2>
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 text-muted-foreground">动作</TableHead>
                  <TableHead className="px-3 text-muted-foreground">字段</TableHead>
                  <TableHead className="px-3 text-muted-foreground">类型</TableHead>
                  <TableHead className="px-3 text-muted-foreground">必填</TableHead>
                  <TableHead className="px-3 text-muted-foreground">语义</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fieldRows(rows).map((row) => (
                  <TableRow key={`${row.action}:${row.name}`}>
                    <TableCell className="px-3 py-2">{row.action}</TableCell>
                    <TableCell className="px-3 py-2">{row.name}</TableCell>
                    <TableCell className="px-3 py-2">{row.type}</TableCell>
                    <TableCell className="px-3 py-2">{row.required}</TableCell>
                    <TableCell className="px-3 py-2">{row.semantics}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* T35 S7.3/S11:生命周期动作区(修订/废弃)随详情直达——此前只在通用
          合同页可达,定义管理主旅程断链;禁用原因走 guard-results 人话主句。 */}
      <MetaActions entity={entity} rel={rel} scope={scope} onChanged={onChanged} />
    </div>
  );
}
