'use client';
/**
 * 聊天消息区(T9 Phase B):assistant-ui 官方 stock thread 裁剪版。
 *
 * 来源:`pnpm dlx assistant-ui add thread markdown-text`(registry 落本站后
 * 按合同裁剪)——裁掉附件/听写/建议/分支/动作栏等与本站无关的件,保留
 * Viewport 自动滚动 + Composer 原语 + MarkdownText(react-markdown);
 * 合同锚点(悬浮聊天 e2e/jsdom 断言依赖,不可改):
 * - 输入框 placeholder「输入目标…」;发送/停止按钮文本与
 *   data-nav="local:chat-send|chat-cancel";委托模式开关 aria-label「委托模式」
 *   + aria-pressed + data-nav="local:chat-delegated"(全局思考过程开关已在
 *   T24 Phase B 移除:思考区默认折叠常在,无需整体隐藏);
 * - running 指示:三点 typing(替代 stock 的裸「●」);
 * - 轨迹步骤卡:step 帧携带的 rel 经 metadata.custom 传入——rel 以 `flow:`
 *   前缀开头(结构化 flow rel)时以 Badge 弱化呈现 rel(纯展示层,零文本
 *   启发式:不对 message.text 做任何匹配,T32 Q4);
 * - 轨迹活动条目(T24 Phase B):step 帧携带 activity={op,title?,subject?}
 *   (经 metadata.custom)时主呈现为固定 op 词表的活动语言(「正在读取
 *   <标题>」「正在执行 <动作>」…,标题由服务器取自合同,客户端零猜测);
 *   机器日志原文不直出(保留在消息数据作机器层);未知 op 中性回退并显式
 *   携带 op。整条可点下钻事件流(eventSeq 定位到本步 chat-turn-progress
 *   事件;缺失退 /events 页);无 activity 的轨迹外补充说明帧(如 max-steps
 *   上限说明)按机器原文中性显示;
 * - 思考区(T11 Phase C + T24 Phase B):thinking 增量/终帧条目
 *   (metadata.custom.thinking = 归步步号)按 (turnId, step) 各渲染为一条
 *   可折叠思考区(Collapsible,默认收起——推理是次级信息;aria-expanded/
 *   aria-controls 语义可达)。进行中条目(线程 running 且本条是末条消息 =
 *   当前步思考仍在累积/执行)触发器为紧凑进行中指示「思考中 · 第 N 步」
 *   (含步数,无机制词),展开即实时思考增量;同号 step 帧到达或回合结束
 *   后回落「思考 · 步骤 N」,仍可展开查看(数据不丢,只改呈现);
 * - 失败终局条目(T24 Phase B Task 3:失败措辞分层):final/error 帧携带
 *   reason={code, evidence?, tried?, phrasing?}(经 metadata.custom.failure)
 *   时按 AI-first 分层——LLM 表述在场则主呈现 phrasing(附「助手表述」来源
 *   标注),缺席则中性结构化行「失败 · code=… · 已尝试:…」(零硬编码友好
 *   文案);结构化本体始终收纳于可展开的失败数据区(审计可达)。不携带
 *   failure 数据的 assistant 消息(回答/摘要等)走常规文本呈现。
 */
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type TextMessagePartComponent,
} from '@assistant-ui/react';
import { Suspense } from 'react';

import type { ChatFailureReason, ChatStepActivity } from '@/chat/sse';
import { MarkdownText } from '@/components/assistant-ui/markdown-text';
import { isChatStepActivity, stepActivityText } from '@/components/chat/step-activity-words';
import { CitationList } from '@/components/chat/citation-list';
import { failureNeutralLine, isChatFailureReason } from '@/components/chat/failure-words';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, SendHorizontal, Square } from 'lucide-react';

/** 当前消息的 rel(external store 经 convertMessage 的 metadata.custom.rel 传入)。 */
function useMessageRel(): string | undefined {
  return useAuiState((s) => {
    const value: unknown = s.message.metadata.custom['rel'];
    return typeof value === 'string' && value !== '' ? value : undefined;
  });
}

/** 当前消息的思考步号(T11:convertMessage 的 metadata.custom.thinking;非思考条目为 undefined)。 */
function useMessageThinkingStep(): number | undefined {
  return useAuiState((s) => {
    const value: unknown = s.message.metadata.custom['thinking'];
    return typeof value === 'number' ? value : undefined;
  });
}

/**
 * 当前消息的轨迹活动数据(T24 Phase B:convertMessage 的
 * metadata.custom.activity;守卫命中返回原引用,Object.is 稳定)。
 */
function useMessageActivity(): ChatStepActivity | undefined {
  return useAuiState((s) => {
    const value: unknown = s.message.metadata.custom['activity'];
    return isChatStepActivity(value) ? value : undefined;
  });
}

/** 当前消息的审计事件 seq(chat-turn-progress 日志定位;缺失为 undefined)。 */
function useMessageEventSeq(): number | undefined {
  return useAuiState((s) => {
    const value: unknown = s.message.metadata.custom['eventSeq'];
    return typeof value === 'number' ? value : undefined;
  });
}

/**
 * 当前消息的结构化失败数据(T24 Phase B Task 3:convertMessage 的
 * metadata.custom.failure;守卫命中返回原引用,Object.is 稳定)。
 */
function useMessageFailure(): ChatFailureReason | undefined {
  return useAuiState((s) => {
    const value: unknown = s.message.metadata.custom['failure'];
    return isChatFailureReason(value) ? value : undefined;
  });
}

/** Raw citation metadata; CitationList owns strict validation and exact-pair dedupe. */
function useMessageCitations(): unknown {
  return useAuiState((s) => s.message.metadata.custom['citations']);
}

/**
 * 活动条目的审计下钻目标(T24 Phase B):eventSeq 在场时指向 /api/events 的
 * afterSeq 定位窗口(本步 chat-turn-progress 事件恰为首条);缺失(落库失败)
 * 指向事件流页 /events——两者都真实存在,不伪造定位参数。
 */
function stepAuditHref(eventSeq: number | undefined): string {
  if (eventSeq === undefined) return '/events';
  return `/api/events?afterSeq=${Math.max(0, eventSeq - 1)}`;
}

/**
 * 本条消息是否为进行中的思考条目(T24 Phase B):线程 running 且本条是末条
 * 消息——只有正在累积/执行中的当前步思考满足(其同号 step 帧未到;更早
 * 回合与已完成步的思考条目都不是末条)。布尔选择器,Object.is 稳定。
 */
function useIsLiveThinking(): boolean {
  return useAuiState((s) => s.thread.isRunning && s.message.isLast);
}

/** assistant 文本部件:活动语言条目(可点下钻)或 Markdown + 结构化 flow rel 徽章。 */
const AssistantText: TextMessagePartComponent = () => {
  const rel = useMessageRel();
  const activity = useMessageActivity();
  const eventSeq = useMessageEventSeq();
  // 轨迹活动条目(T24 Phase B):主呈现为固定 op 词表的活动语言
  // (「正在读取 文章列表」…);机器日志原文(text)不直出,保留在消息数据
  // 作机器层。整条可点下钻对应事件(原生 <a>,键盘可达)。
  if (activity !== undefined) {
    return (
      <a
        href={stepAuditHref(eventSeq)}
        data-nav={eventSeq !== undefined ? `audit:${eventSeq}` : 'audit:events'}
        title="在事件流中查看本步事件"
        className="inline-flex w-fit items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        {stepActivityText(activity)}
      </a>
    );
  }
  const showRel = rel !== undefined && rel.startsWith('flow:');
  return (
    <span className="block">
      {showRel && (
        <Badge
          variant="outline"
          data-testid="flow-rel-badge"
          className="mb-1 block w-fit text-[10px] font-normal text-muted-foreground"
        >
          {rel}
        </Badge>
      )}
      <MarkdownText />
    </span>
  );
};

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex w-full justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm whitespace-pre-wrap text-primary-foreground">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

/** 思考区文本部件:推理自述是模型自由文本,直出(不走 Markdown 管线)。 */
const ThinkingText: TextMessagePartComponent = ({ text }) => (
  <span className="block whitespace-pre-wrap">{text}</span>
);

/**
 * 思考区条目(T11 Phase C + T24 Phase B):llm 步推理自述——次级信息,默认
 * 收起;进行中呈现为一条紧凑的「思考中 · 第 N 步」指示(脉冲点 + 步数),
 * 展开即实时思考增量,完成/回合结束后回落「思考 · 步骤 N」仍可展开查看。
 */
function ThinkingMessage({ step }: { step: number }) {
  const active = useIsLiveThinking();
  return (
    <MessagePrimitive.Root className="flex w-full justify-start">
      <Collapsible className="max-w-[85%] rounded-lg border border-border px-3 py-1.5">
        <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground [&[data-state=open]>svg]:rotate-180">
          <ChevronDown className="h-3 w-3 transition-transform" />
          {active ? `思考中 · 第 ${step} 步` : `思考 · 步骤 ${step}`}
          {active && (
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60"
            />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1 text-xs text-muted-foreground">
          <MessagePrimitive.Parts components={{ Text: ThinkingText }} />
        </CollapsibleContent>
      </Collapsible>
    </MessagePrimitive.Root>
  );
}

/**
 * 失败终局条目(T24 Phase B Task 3:失败措辞分层):
 * - LLM 表述在场(phrasing)→ 主呈现为表述,附「助手表述」来源标注;
 * - 缺席 → 中性结构化行「失败 · code=… · 已尝试:…」(零硬编码友好文案);
 * - 结构化数据本体(code/已尝试/机械事实)始终收纳在可展开的失败数据区,
 *   审计视角可达,不随主呈现选择消失。
 */
function FailureMessage({ failure }: { failure: ChatFailureReason }) {
  const tried = failure.tried ?? [];
  return (
    <MessagePrimitive.Root className="flex w-full justify-start">
      <div className="max-w-[85%] space-y-1 rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm text-foreground">
        {failure.phrasing !== undefined ? (
          <>
            <p className="whitespace-pre-wrap">{failure.phrasing}</p>
            <p className="text-[10px] text-muted-foreground">助手表述</p>
          </>
        ) : (
          <p>{failureNeutralLine(failure)}</p>
        )}
        <details className="text-xs text-muted-foreground">
          <summary>失败数据</summary>
          <div className="mt-1 space-y-0.5">
            <div>code={failure.code}</div>
            {tried.length > 0 && <div>已尝试:{tried.join('、')}</div>}
            {(failure.evidence ?? []).map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        </details>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const thinkingStep = useMessageThinkingStep();
  const failure = useMessageFailure();
  const citations = useMessageCitations();
  // thinking 帧条目:可折叠思考区(与气泡步骤消息按到达序相邻)。
  if (thinkingStep !== undefined) {
    return <ThinkingMessage step={thinkingStep} />;
  }
  // 失败终局条目(T24 Phase B Task 3):按措辞分层呈现(见 FailureMessage)。
  if (failure !== undefined) {
    return <FailureMessage failure={failure} />;
  }
  return (
    <MessagePrimitive.Root className="flex w-full justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm text-foreground">
        <MessagePrimitive.Parts components={{ Text: AssistantText }} />
        <Suspense fallback={null}>
          <CitationList citations={citations} />
        </Suspense>
      </div>
    </MessagePrimitive.Root>
  );
}

/** running 三点 typing 指示(替代 stock 的裸「●」)。 */
function TypingIndicator() {
  return (
    <div className="flex w-full justify-start" aria-label="助手执行中">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3 py-2.5">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
      </div>
    </div>
  );
}

export interface ChatThreadProps {
  delegated: boolean;
  onToggleDelegated: () => void;
}

export function ChatThread({ delegated, onToggleDelegated }: ChatThreadProps) {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <ThreadPrimitive.Empty>
          <p className="py-8 text-center text-xs text-muted-foreground">
            说出你想做成的事,如「发布一篇文章」;助手与你过同一道门,每步可见。
          </p>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <ThreadPrimitive.If running>
          <TypingIndicator />
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>
      <ComposerPrimitive.Root className="flex items-center gap-2 border-t border-border p-2">
        <ComposerPrimitive.Input
          rows={1}
          placeholder="输入目标…"
          className="max-h-24 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
        />
        {/* 委托模式开关(T5 Phase B):on→mode:'delegated' 派发 workflow。
            T35 F-08③/W4:两种提交的续跑语义就地说明(发送=在线协同,页面可切;
            委托=交后台无人值守,进「在动」)。 */}
        <Button
          type="button"
          variant={delegated ? 'default' : 'secondary'}
          size="sm"
          aria-label="委托模式"
          title={
            delegated
              ? '已切委托:交后台无人值守,进度看「在动」'
              : '在线协同:助手边问边做,页面可切,进度看这里'
          }
          data-nav="local:chat-delegated"
          aria-pressed={delegated}
          onClick={onToggleDelegated}
        >
          {delegated ? '委托(后台)' : '协同'}
        </Button>
        <ThreadPrimitive.If running={false}>
          <ComposerPrimitive.Send asChild>
            <Button type="button" size="icon-sm" aria-label="发送" data-nav="local:chat-send">
              <SendHorizontal />
            </Button>
          </ComposerPrimitive.Send>
        </ThreadPrimitive.If>
        <ThreadPrimitive.If running>
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label="停止"
              data-nav="local:chat-cancel"
            >
              <Square />
            </Button>
          </ComposerPrimitive.Cancel>
        </ThreadPrimitive.If>
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
}
