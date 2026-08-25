'use client';
/**
 * BIOS 能力查看面(T13 Phase C Task 3;spec 架构决定 3):capability 定义的
 * 只读属性投影视图。
 *
 * - meta/capability:<name> 投影的属性表形状:name/title/kind/intent(+可选
 *   input/output)原样键值呈现——全部来自 Siren 投影,零业务分支;
 * - 只读:零动作按钮(编辑动词归后续,spec 架构决定 5 口径;投影本身也不
 *   携带 actions);
 * - 渲染零 AI(铁律 5):机械投影渲染,不引入任何 AI/LLM 依赖(源级断言见
 *   diff-render.test.tsx 名单)。
 */
import type { SirenEntity } from '@ui4a/engine';

import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';

import { useMetaEntity } from './meta-client';

/** 属性表键值对(标量与一层数组;对象 JSON——与 flow-definition-view 同口径)。 */
function propertyPairs(entity: SirenEntity): [string, string][] {
  return Object.entries(entity.properties).map(([key, value]) => {
    if (Array.isArray(value)) return [key, value.map(String).join(', ')];
    if (value !== null && typeof value === 'object') return [key, JSON.stringify(value)];
    return [key, String(value)];
  });
}

export interface CapabilityDefinitionViewProps {
  rel: string;
  entity: SirenEntity;
}

/** 能力定义查看(纯渲染;数据来自 /_meta/api/entity?rel=meta/capability:<name>)。 */
export function CapabilityDefinitionView({ rel, entity }: CapabilityDefinitionViewProps) {
  const properties = entity.properties;
  const heading =
    typeof properties.title === 'string' && properties.title !== ''
      ? properties.title
      : String(properties.name ?? rel);

  return (
    <div>
      <nav className="mb-2 text-sm">
        <a href="/meta" data-nav="meta-back" className="text-primary hover:underline">
          ← 定义管理
        </a>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
      <p className="mt-1 text-xs text-muted-foreground">{rel}</p>

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
    </div>
  );
}

/** 页面主体:取数状态机 + CapabilityDefinitionView(404/异常如实呈现)。 */
export function CapabilityDefinitionBody({ rel }: { rel: string }) {
  const { entity, state } = useMetaEntity(rel);

  if (state === 'error' || state === 'missing') {
    return (
      <div>
        <nav className="mb-2 text-sm">
          <a href="/meta" data-nav="meta-back" className="text-primary hover:underline">
            ← 定义管理
          </a>
        </nav>
        <p className="text-sm">
          {state === 'missing' ? `能力 "${rel}" 不存在(404)。` : '读取能力失败(服务不可用)。'}
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
  return <CapabilityDefinitionView rel={rel} entity={entity} />;
}
