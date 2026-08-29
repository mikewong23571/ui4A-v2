'use client';
/**
 * member-table 词条:集合成员呈现为表格行(通用词汇,由组合区域声明的
 * density='table' 驱动;catalog pattern 选择,零实体类型特判)。
 *
 * - 语义 <table>——列:主体(label 链接走 canvasEntityHref 画布落面,下挂
 *   mono 小字 rel)/ 状态 / 详情(超长截断 + title)/ 操作(actions);
 * - 操作列用 ActionGroup density='compact':行内动作、零图例(披露保留在
 *   详情面),guard 投影/两步确认/prefill 语义与 default 完全同一台;
 * - 成员无动作时操作列留空(ActionGroup 对零动作实体返回 null,零分支);
 *   单词段(status/detail)缺省时诚实空单元格,不发明占位事实;
 * - bindings 与 member-card 完全相同(逐行 item 解引用),repeat 每成员一实例,
 *   colgroup 固定列宽使多行实例对齐成表。
 */
import type { SirenEntity } from '@ui4a/engine';

import { canvasEntityHref } from '@/presence/navigation';

import { ActionGroup } from '../../components/actions/action-group';

import {
  asOptionalActions,
  asOptionalFields,
  asOptionalGuardResults,
  asOptionalString,
  asRequiredString,
  type WordProps,
} from './shared';

export function MemberTableWord(props: WordProps) {
  const label = asRequiredString(props.label, 'member-table', 'label');
  const rel = asRequiredString(props.rel, 'member-table', 'rel');
  const status = asOptionalString(props.status, 'member-table', 'status');
  const detail = asOptionalString(props.detail, 'member-table', 'detail');
  const actions = asOptionalActions(props.actions, 'member-table', 'actions');
  const guardResults = asOptionalGuardResults(props.guardResults, 'member-table', 'guardResults');
  const fields = asOptionalFields(props.fields, 'member-table', 'fields');

  // 行内动作只消费动作裁决所需的最小合同面;标识与预填取值来自成员投影。
  const entity: SirenEntity = {
    class: ['presentation-member-table'],
    properties: { rel, ...(fields === undefined ? {} : { fields }) },
    actions,
    links: [],
    'guard-results': guardResults,
  };

  return (
    <table data-word="member-table" data-rel={rel} className="w-full table-fixed border-collapse">
      <colgroup>
        <col className="w-[38%]" />
        <col className="w-[14%]" />
        <col className="w-[30%]" />
        <col className="w-[18%]" />
      </colgroup>
      <tbody>
        <tr className="border-b">
          <td className="px-2 py-2 align-top">
            <a
              data-nav="presentation:member"
              href={canvasEntityHref(rel)}
              title={label}
              className="block truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
            >
              {label}
            </a>
            <p className="truncate font-mono text-xs text-muted-foreground" title={rel}>
              {rel}
            </p>
          </td>
          <td className="px-2 py-2 align-top text-xs text-muted-foreground">
            {status === undefined ? null : (
              <span className="block truncate" title={status}>
                {status}
              </span>
            )}
          </td>
          <td className="px-2 py-2 align-top text-xs text-muted-foreground">
            {detail === undefined ? null : (
              <span className="block truncate" title={detail}>
                {detail}
              </span>
            )}
          </td>
          <td className="px-2 py-2 align-top">
            <ActionGroup entity={entity} density="compact" />
          </td>
        </tr>
      </tbody>
    </table>
  );
}
