'use client';
/**
 * BIOS 定义查看面(T4 Phase C;spec 架构决定 7):flow 定义的纯文本/表格视图;
 * T13 Phase A(spec 架构决定 1)在表格之上增只读拓扑图。
 *
 * - meta/flow:<name> 与 meta/self 共用(同一 flow-definition 投影形状):
 *   拓扑区(FlowTopologyView,只读 React Flow)+ 属性表 + 节点表 + 动作表
 *   (name/to/guards/requires-confirmation/effect)+ 字段表——全部来自
 *   Siren 投影,零业务分支;
 * - 渲染零 AI(铁律 5):机械投影,不引入任何 AI/LLM 依赖。
 */
import type { FieldDefinition, SirenEntity } from '@ui4a/engine';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { FlowTopologyView } from './flow-topology-view';
import { useMetaEntity } from './meta-client';

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
  for (const node of entity.entities ?? []) {
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
function propertyPairs(entity: SirenEntity): [string, string][] {
  return Object.entries(entity.properties).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.map(String).join(', ')];
    if (value !== null && typeof value === 'object') return [key, JSON.stringify(value)];
    return [key, String(value)];
  });
}

export interface FlowDefinitionViewProps {
  rel: string;
  entity: SirenEntity;
}

/** 定义查看(纯渲染;数据来自 /_meta/api/entity?rel=meta/flow:<name>|meta/self)。 */
export function FlowDefinitionView({ rel, entity }: FlowDefinitionViewProps) {
  const properties = entity.properties;
  const heading =
    typeof properties.title === 'string' && properties.title !== ''
      ? properties.title
      : String(properties.name ?? rel);
  const rows = actionRows(entity);

  return (
    <div>
      <nav className="mb-2 text-sm">
        <a href="/meta" data-nav="meta-back" className="text-primary hover:underline">
          ← BIOS
        </a>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
      <p className="mt-1 text-xs text-muted-foreground">{rel}</p>

      <section aria-label="拓扑" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">拓扑</h2>
        <FlowTopologyView entity={entity} />
      </section>

      <section aria-label="属性" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">属性</h2>
        <div className="rounded-md border bg-card">
          <Table>
            <TableBody>
              {propertyPairs(entity).map(([key, value]) => (
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

      <section aria-label="节点" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">节点({(entity.entities ?? []).length})</h2>
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
              {(entity.entities ?? []).map((node) => (
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
    </div>
  );
}

/** 页面主体:取数状态机 + FlowDefinitionView(404/异常如实呈现)。 */
export function FlowDefinitionBody({ rel }: { rel: string }) {
  const { entity, state } = useMetaEntity(rel);

  if (state === 'error' || state === 'missing') {
    return (
      <div>
        <nav className="mb-2 text-sm">
          <a href="/meta" data-nav="meta-back" className="text-primary hover:underline">
            ← BIOS
          </a>
        </nav>
        <p className="text-sm">
          {state === 'missing' ? `定义 "${rel}" 不存在(404)。` : '读取定义失败(服务不可用)。'}
        </p>
      </div>
    );
  }
  if (state === 'loading' || entity === null) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">加载中…</p>
      </div>
    );
  }
  return <FlowDefinitionView rel={rel} entity={entity} />;
}
