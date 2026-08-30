'use client';
/**
 * member-table 词条:集合成员呈现为表格行(通用词汇,由组合区域声明的
 * density='table' 驱动;catalog pattern 选择,零实体类型特判)。
 *
 * - 语义 <table>——列:主体(label 链接走 canvasEntityHref 画布落面,下挂
 *   mono 小字 rel)/ 状态(成员 status 词位,US2 过滤的语义锚,恒保留)/
 *   概览列 / 操作(actions);
 * - 概览列(T38 FR4):成员 presentation.fields 声明 overview:true 的字段按
 *   声明序进概览行,title 为列语义(声明数据,零渲染器发明文案);identity
 *   与 status 角色的声明字段跳过(主体列/状态列即其语义,零重复渲染);
 *   成员缺该字段诚实空单元格;无有效概览声明回退现状(身份/状态/详情/操作);
 * - 操作列用 ActionGroup density='compact':行内动作、零图例(披露保留在
 *   详情面),guard 投影/两步确认/prefill 语义与 default 完全同一台;
 * - 成员无动作时操作列留空(ActionGroup 对零动作实体返回 null,零分支);
 *   单词段(status/detail)缺省时诚实空单元格,不发明占位事实;
 * - bindings 与 member-card 完全相同(逐行 item 解引用),repeat 每成员一实例,
 *   colgroup 固定列宽使多行实例对齐成表。
 */
import type { ReactElement } from 'react';
import type { SirenEntity } from '@ui4a/engine';

import { canvasEntityHref } from '@/presence/navigation';

import { ActionGroup } from '../../components/actions/action-group';

import {
  asOptionalActions,
  asOptionalFields,
  asOptionalGuardResults,
  asOptionalPresentations,
  asOptionalString,
  asRequiredString,
  type WordProps,
} from './shared';
import { declaredMemberOverview, type DeclaredMemberOverview } from './member-overview';

/** 现状回退列宽(身份/状态/详情/操作);概览列按声明数均分主体区。 */
const FALLBACK_COLUMNS = [38, 14, 30, 18] as const;
const OVERVIEW_IDENTITY_WIDTH = 24;
const OVERVIEW_STATUS_WIDTH = 12;
// 操作列需容纳两个紧凑小按钮并排(约 120px 内容宽 @1100px 表宽 ≈ 11%,取
// 16% 留余量);概览列均分剩余,宽度不足正是按钮纵向堆叠的成因。
const OVERVIEW_ACTIONS_WIDTH = 16;

export function MemberTableWord(props: WordProps) {
  const label = asRequiredString(props.label, 'member-table', 'label');
  const rel = asRequiredString(props.rel, 'member-table', 'rel');
  const status = asOptionalString(props.status, 'member-table', 'status');
  const detail = asOptionalString(props.detail, 'member-table', 'detail');
  const actions = asOptionalActions(props.actions, 'member-table', 'actions');
  const guardResults = asOptionalGuardResults(props.guardResults, 'member-table', 'guardResults');
  const fields = asOptionalFields(props.fields, 'member-table', 'fields');
  const presentations = asOptionalPresentations(
    props.presentations,
    'member-table',
    'presentations',
  );
  // 概览列:声明 overview 且角色不与既有固定列重复(identity=主体列、
  // status=状态列,声明数据可判,零字段名特判)。
  const overviewColumns = declaredMemberOverview(presentations, fields);

  // 行内动作只消费动作裁决所需的最小合同面;标识与预填取值来自成员投影。
  const entity: SirenEntity = {
    class: ['presentation-member-table'],
    properties: { rel, ...(fields === undefined ? {} : { fields }) },
    actions,
    links: [],
    'guard-results': guardResults,
  };

  const identityCell = (
    <td className="block min-w-0 px-2 py-2 align-top md:table-cell">
      <a
        data-nav="presentation:member"
        href={canvasEntityHref(rel)}
        title={label}
        className="block break-words text-sm font-medium text-foreground hover:text-primary hover:underline md:truncate"
      >
        {label}
      </a>
      <p className="break-all font-mono text-xs text-muted-foreground md:truncate" title={rel}>
        {rel}
      </p>
    </td>
  );
  const actionsCell = (
    <td
      data-mobile-label="操作"
      className="block min-w-0 px-2 py-2 align-top before:mb-1 before:block before:text-[10px] before:font-medium before:text-muted-foreground before:content-[attr(data-mobile-label)] md:table-cell md:before:hidden"
    >
      <ActionGroup entity={entity} density="compact" />
    </td>
  );
  const wordCell = (value: string | undefined, label: string): ReactElement => (
    <td
      data-mobile-label={label}
      className="block min-w-0 px-2 py-2 align-top text-xs text-muted-foreground before:mb-1 before:block before:text-[10px] before:font-medium before:content-[attr(data-mobile-label)] md:table-cell md:before:hidden"
    >
      {value === undefined ? null : (
        <span className="block whitespace-pre-wrap break-words md:truncate" title={value}>
          {value}
        </span>
      )}
    </td>
  );
  const overviewCell = ({ presentation, value }: DeclaredMemberOverview): ReactElement => {
    return (
      <td
        key={presentation.path}
        data-column={presentation.path}
        data-mobile-label={presentation.title}
        title={presentation.title}
        className="block min-w-0 px-2 py-2 align-top text-xs text-muted-foreground before:mb-1 before:block before:text-[10px] before:font-medium before:content-[attr(data-mobile-label)] md:table-cell md:before:hidden"
      >
        {value === undefined ? null : (
          <span className="block whitespace-pre-wrap break-words md:truncate" title={value}>
            {value}
          </span>
        )}
      </td>
    );
  };

  const declaredOverview = overviewColumns.length > 0;
  const columns = declaredOverview
    ? [
        OVERVIEW_IDENTITY_WIDTH,
        OVERVIEW_STATUS_WIDTH,
        ...overviewColumns.map(() => overviewWidth(overviewColumns.length)),
        OVERVIEW_ACTIONS_WIDTH,
      ]
    : [...FALLBACK_COLUMNS];

  return (
    <table
      data-word="member-table"
      data-rel={rel}
      className="block w-full border-collapse md:table md:table-fixed"
    >
      <colgroup className="hidden md:table-column-group">
        {columns.map((width, index) => (
          <col key={index} style={{ width: `${width}%` }} />
        ))}
      </colgroup>
      <tbody className="block md:table-row-group">
        <tr className="block rounded-lg border bg-card p-2 md:table-row md:rounded-none md:border-x-0 md:border-t-0 md:bg-transparent md:p-0">
          {identityCell}
          {wordCell(status, '状态')}
          {declaredOverview ? overviewColumns.map(overviewCell) : wordCell(detail, '摘要')}
          {actionsCell}
        </tr>
      </tbody>
    </table>
  );
}

function overviewWidth(count: number): number {
  const share = 100 - OVERVIEW_IDENTITY_WIDTH - OVERVIEW_STATUS_WIDTH - OVERVIEW_ACTIONS_WIDTH;
  return Math.floor(share / Math.max(count, 1));
}
