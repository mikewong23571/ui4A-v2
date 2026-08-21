'use client';
/**
 * BIOS 定义查看面(T4 Phase C;spec 架构决定 7):flow 定义的纯文本/表格视图。
 *
 * - meta/flow:<name> 与 meta/self 共用(同一 flow-definition 投影形状):
 *   属性表 + 节点表 + 动作表(name/to/guards/requires-confirmation/effect)+
 *   字段表——全部来自 Siren 投影,零业务分支;不做 Stately/React Flow 可视化
 *   (T7 非目标),状态机以表格文本呈现;
 * - 渲染零 AI(铁律 5):机械表格,不引入任何 AI/LLM 依赖。
 */
import type { FieldDefinition, SirenEntity } from '@ui4a/engine';

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
          props['requires-confirmation'] === undefined ? '' : String(props['requires-confirmation']),
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
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <nav className="mb-2 text-sm">
        <a href="/meta" data-nav="meta-back" className="text-blue-600 hover:underline">
          ← BIOS
        </a>
      </nav>
      <h1 className="text-2xl font-semibold text-zinc-900">{heading}</h1>
      <p className="mt-1 text-xs text-zinc-500">{rel}</p>

      <section aria-label="属性" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">属性</h2>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {propertyPairs(entity).map(([key, value]) => (
              <tr key={key} className="border-b border-zinc-100">
                <th scope="row" className="py-1 pr-4 text-left font-normal text-zinc-500">
                  {key}
                </th>
                <td className="py-1 break-all text-zinc-800">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="节点" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">
          节点({(entity.entities ?? []).length})
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              <th className="py-1 pr-4">节点</th>
              <th className="py-1 pr-4">标题</th>
              <th className="py-1">动作数</th>
            </tr>
          </thead>
          <tbody>
            {(entity.entities ?? []).map((node) => (
              <tr key={String(node.properties.name)} className="border-b border-zinc-100">
                <td className="py-1 pr-4 text-zinc-800">{String(node.properties.name)}</td>
                <td className="py-1 pr-4 text-zinc-800">{String(node.properties.title ?? '')}</td>
                <td className="py-1 text-zinc-800">{(node.entities ?? []).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="动作" className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-zinc-700">动作</h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
              <th className="py-1 pr-4">节点</th>
              <th className="py-1 pr-4">动作</th>
              <th className="py-1 pr-4">to</th>
              <th className="py-1 pr-4">guards</th>
              <th className="py-1 pr-4">确认</th>
              <th className="py-1">effect</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.node}:${row.name}`} className="border-b border-zinc-100">
                <td className="py-1 pr-4 text-zinc-800">{row.node}</td>
                <td className="py-1 pr-4 text-zinc-800">{row.name}</td>
                <td className="py-1 pr-4 text-zinc-800">{row.to}</td>
                <td className="py-1 pr-4 text-zinc-800">{row.guards}</td>
                <td className="py-1 pr-4 text-zinc-800">{row.confirmation}</td>
                <td className="py-1 break-all text-zinc-800">{row.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {fieldRows(rows).length > 0 && (
        <section aria-label="字段" className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">字段</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                <th className="py-1 pr-4">动作</th>
                <th className="py-1 pr-4">字段</th>
                <th className="py-1 pr-4">类型</th>
                <th className="py-1 pr-4">必填</th>
                <th className="py-1">语义</th>
              </tr>
            </thead>
            <tbody>
              {fieldRows(rows).map((row) => (
                <tr key={`${row.action}:${row.name}`} className="border-b border-zinc-100">
                  <td className="py-1 pr-4 text-zinc-800">{row.action}</td>
                  <td className="py-1 pr-4 text-zinc-800">{row.name}</td>
                  <td className="py-1 pr-4 text-zinc-800">{row.type}</td>
                  <td className="py-1 pr-4 text-zinc-800">{row.required}</td>
                  <td className="py-1 text-zinc-800">{row.semantics}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

/** 页面主体:取数状态机 + FlowDefinitionView(404/异常如实呈现)。 */
export function FlowDefinitionBody({ rel }: { rel: string }) {
  const { entity, state } = useMetaEntity(rel);

  if (state === 'error' || state === 'missing') {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-6">
        <nav className="mb-2 text-sm">
          <a href="/meta" data-nav="meta-back" className="text-blue-600 hover:underline">
            ← BIOS
          </a>
        </nav>
        <p className="text-sm text-zinc-700">
          {state === 'missing' ? `定义 "${rel}" 不存在(404)。` : '读取定义失败(服务不可用)。'}
        </p>
      </main>
    );
  }
  if (state === 'loading' || entity === null) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-6">
        <p className="text-sm text-zinc-500">加载中…</p>
      </main>
    );
  }
  return <FlowDefinitionView rel={rel} entity={entity} />;
}
