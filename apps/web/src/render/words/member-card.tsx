'use client';
/**
 * member-card 词条(T33 Phase D / D50 责任点一等):集合成员携带已声明动作时,
 * 成员渲染为决策卡——身份行(人话 identity)+ 合同标识 + 统一动作组
 * (ActionGroup:收起触发键、guard 投影、人/AI 同权图例)。
 *
 * 输入全部来自成员合同的逐行 item 解引用(label/rel/actions/guard-results/
 * properties.fields);动作经宿主 ActionSubmitProvider 提交,同一裁决器,
 * 零实体类型分支。成员无动作时只有身份行(渲染器零分支)。
 *
 * T56 P3.2(US02/US04;D78 决定 2/4):工作线 approval 角色成员卡是责任卡,
 * 但线投影成员卡不带确认实体读字段(properties.resume 缺失)——决策所需
 * 的「对象/动作/依据」不可读。本词条对 rel 为 confirmation: 前缀且缺
 * detail 的成员卡(纯指针前缀 + 声明字段缺失判别,不解析自然语言),按 rel
 * 懒读被引确认实体(no-store,每挂载重读,同 citation chips 口径;数量以
 * approval 引用上界为界),复用 T54 知情确认/决定回执词汇:
 * - pending:对象/动作/依据(政策原因)同卡可读;确认合同无前值/影响声明
 *   字段 → 「改变前后」显式「未提供」,不用当前值假扮批准时依据;
 * - 已决:T54 决定回执回读(已由 X 批准/驳回 + 驳回原因),无动作面;
 * - 被引目标是 meta/ 定义(纯指针前缀判别)→ 本卡不渲染内联 approve/reject,
 *   显式跨入治理宿主路由(/meta/entity?rel=<target>;BIOS 审查不进本线内联面,
 *   D74 批准编排不经本卡新增路径);
 * - 读取失败诚实回退既有渲染,不编造决定信息。
 */
import { useEffect, useState, type ReactNode } from 'react';

import type { SirenEntity } from '@ui4a/engine';

import { cn } from '@/lib/utils';
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
import { declaredMemberOverview } from './member-overview';

const CONFIRMATION_REL_PREFIX = 'confirmation:';
const META_REL_PREFIX = 'meta/';
/** 确认合同现无前值/影响声明字段:改变前后显式未知(A2),不编造。 */
const CHANGE_BEFORE_AFTER = '未提供';

/** 懒读确认实体的一态(组件实例内;失败不跨挂载持久)。 */
type ConfirmationRead =
  | { status: 'loading' }
  | { status: 'readable'; document: Record<string, unknown> }
  | { status: 'unreadable' };

/** confirmation 合同的知情决定字段(T54 projectConfirmation 投影词汇)。 */
interface ConfirmationDecisionFacts {
  targetRel?: string;
  targetAction?: string;
  policyReason?: string;
  status?: string;
  decidedByActor?: string;
  rejectedReason?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function decisionFactsOf(document: Record<string, unknown>): ConfirmationDecisionFacts {
  // 读取目标是 /api/entity 的 Siren 实体:知情决定读字段在 properties 字典内。
  const source =
    typeof document.properties === 'object' && document.properties !== null
      ? (document.properties as Record<string, unknown>)
      : {};
  const decidedBy =
    typeof source['decided-by'] === 'object' && source['decided-by'] !== null
      ? (source['decided-by'] as Record<string, unknown>)
      : undefined;
  return {
    targetRel: asString(source['target-rel']),
    targetAction: asString(source['target-action']),
    policyReason: asString(source['policy-reason']),
    status: asString(source.status),
    decidedByActor: decidedBy === undefined ? undefined : asString(decidedBy.actor),
    rejectedReason: asString(source['rejected-reason']),
  };
}

function useConfirmationRead(rel: string, enabled: boolean): ConfirmationRead {
  // 读态与 rel 同槽存放:rel 漂移的瞬时未定态在渲染期派生为 loading,
  // effect 内只在外部系统回调里 setState(react-hooks 纪律)。
  const [state, setState] = useState<{ rel: string; read: ConfirmationRead }>({
    rel,
    read: { status: 'loading' },
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    fetch(`/api/entity?rel=${encodeURIComponent(rel)}`, { cache: 'no-store' })
      .then(async (response): Promise<ConfirmationRead> => {
        if (!response.ok) return { status: 'unreadable' };
        const document = (await response.json()) as unknown;
        return typeof document === 'object' && document !== null
          ? { status: 'readable', document: document as Record<string, unknown> }
          : { status: 'unreadable' };
      })
      .catch(() => ({ status: 'unreadable' }) as ConfirmationRead)
      .then((next) => {
        if (!cancelled) setState({ rel, read: next });
      });
    return () => {
      cancelled = true;
    };
  }, [rel, enabled]);
  return state.rel === rel ? state.read : { status: 'loading' };
}

function DecisionRow({
  field,
  title,
  children,
}: {
  field: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div data-decision-row={field} className="flex gap-2 text-xs leading-5">
      <span className="shrink-0 font-medium text-muted-foreground">{title}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}

export function MemberCardWord(props: WordProps) {
  const label = asRequiredString(props.label, 'member-card', 'label');
  const rel = asRequiredString(props.rel, 'member-card', 'rel');
  const status = asOptionalString(props.status, 'member-card', 'status');
  const detail = asOptionalString(props.detail, 'member-card', 'detail');
  const actions = asOptionalActions(props.actions, 'member-card', 'actions');
  const guardResults = asOptionalGuardResults(props.guardResults, 'member-card', 'guardResults');
  const fields = asOptionalFields(props.fields, 'member-card', 'fields');
  const presentations = asOptionalPresentations(
    props.presentations,
    'member-card',
    'presentations',
  );
  const overview = declaredMemberOverview(presentations, fields);
  // 用户级密度偏好(T38 疏密贯通):compact 收紧卡片留白与行距、detail 单行
  // 截断;comfortable/spacious 保持既有排版(容器留白由宿主另行处理)。
  const density = asOptionalString(props.density, 'member-card', 'density');
  const compact = density === 'compact';

  // T56 P3.2:线投影责任卡缺确认读字段(detail 缺失)且 rel 指向确认实体
  // → 懒读补齐知情决定面;收件箱等宿主的确认卡已携带 resume,零读取。
  const needsConfirmationRead = rel.startsWith(CONFIRMATION_REL_PREFIX) && detail === undefined;
  const read = useConfirmationRead(rel, needsConfirmationRead);
  const facts = read.status === 'readable' ? decisionFactsOf(read.document) : undefined;
  const metaTarget = facts?.targetRel?.startsWith(META_REL_PREFIX) === true;
  const pendingDecision = facts !== undefined && (facts.status ?? 'pending') === 'pending';

  // 决策卡只消费动作裁决所需的最小合同面;标识与预填取值来自成员投影。
  const entity: SirenEntity = {
    class: ['presentation-member-card'],
    properties: { rel, ...(fields === undefined ? {} : { fields }) },
    actions,
    links: [],
    'guard-results': guardResults,
  };

  return (
    <article
      data-word="member-card"
      data-rel={rel}
      data-density={density}
      className={cn(
        'w-full rounded-lg border bg-card text-card-foreground',
        compact ? 'p-1.5' : 'p-3',
      )}
    >
      {/* 标题行保持成员导航(合同 href → 画布落面),动作行承载责任点 */}
      <a
        data-nav="presentation:member"
        href={canvasEntityHref(rel)}
        className={cn(
          'block text-sm font-medium text-foreground hover:text-primary hover:underline',
          compact && 'truncate',
        )}
      >
        {label}
      </a>
      {detail !== undefined && (
        <p className={cn('text-xs text-muted-foreground', compact ? 'mt-0 truncate' : 'mt-0.5')}>
          {detail}
        </p>
      )}
      <p
        className={cn(
          'font-mono text-xs text-muted-foreground',
          compact ? 'mt-0 truncate' : 'mt-0.5',
        )}
      >
        {status !== undefined ? `${status} · ` : ''}
        {rel}
      </p>
      {facts !== undefined && (
        <section
          aria-label="决定信息"
          data-testid="decision-info"
          className={cn(
            'rounded-md bg-muted/40 px-2 py-1.5',
            compact ? 'mt-1 space-y-0.5' : 'mt-2 space-y-1',
          )}
        >
          {facts.targetRel !== undefined && (
            <DecisionRow field="target" title="对象">
              {metaTarget ? (
                facts.targetRel
              ) : (
                <a
                  data-nav="presentation:decision-target"
                  href={canvasEntityHref(facts.targetRel)}
                  className="font-mono hover:text-primary hover:underline"
                >
                  {facts.targetRel}
                </a>
              )}
            </DecisionRow>
          )}
          {facts.targetAction !== undefined && (
            <DecisionRow field="action" title="动作">
              {facts.targetAction}
            </DecisionRow>
          )}
          {pendingDecision && (
            <DecisionRow field="change" title="改变前后">
              {CHANGE_BEFORE_AFTER}
            </DecisionRow>
          )}
          {facts.policyReason !== undefined && (
            <DecisionRow field="basis" title="依据">
              {facts.policyReason}
            </DecisionRow>
          )}
          {!pendingDecision && facts.decidedByActor !== undefined && (
            <DecisionRow field="receipt" title="决定">
              已由 {facts.decidedByActor} {facts.status === 'rejected' ? '驳回' : '批准'}
            </DecisionRow>
          )}
          {!pendingDecision && facts.rejectedReason !== undefined && (
            <DecisionRow field="reject-reason" title="驳回原因">
              {facts.rejectedReason}
            </DecisionRow>
          )}
        </section>
      )}
      {overview.length > 0 && (
        <div className={cn(compact ? 'mt-1 space-y-0.5' : 'mt-2 space-y-2')}>
          {overview.map(({ presentation, value }) => (
            <div key={presentation.path} data-column={presentation.path}>
              <p className="text-[11px] font-medium text-muted-foreground">{presentation.title}</p>
              {value !== undefined && (
                <p
                  className={cn(
                    'whitespace-pre-wrap break-words text-sm text-foreground',
                    compact ? 'leading-5' : 'leading-6',
                  )}
                >
                  {value}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {metaTarget ? (
        // US02 Meta 边界(D78 决定 4):meta 定义批准不进本线内联审批 UI,
        // 显式跨入可信治理宿主(既有 /meta/entity 路由),零新建审批面。
        <section aria-label="动作" className={compact ? 'mt-1' : 'mt-2'}>
          <a
            data-nav="cross:meta-governance"
            href={`/meta/entity?rel=${encodeURIComponent(facts?.targetRel ?? rel)}`}
            className="inline-flex items-center text-sm text-primary underline"
          >
            Meta 定义变更，进入治理宿主处理
          </a>
        </section>
      ) : (
        actions.length > 0 && (
          <section aria-label="动作" className={compact ? 'mt-1' : 'mt-2'}>
            <ActionGroup entity={entity} />
          </section>
        )
      )}
    </article>
  );
}
