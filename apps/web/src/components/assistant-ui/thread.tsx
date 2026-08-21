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
 *   + aria-pressed + data-nav="local:chat-delegated";
 * - running 指示:三点 typing(替代 stock 的裸「●」);
 * - 轨迹步骤卡:step 帧携带的 rel 经 metadata.custom 传入——flow 实例步
 *   (rel 含 flow 或文本含节点迁移「执行 next(」)以 Badge 弱化呈现 rel
 *   (纯展示层,不改 trail.ts 文本);
 * - 思考区(T11 Phase C):thinking 帧条目(metadata.custom.thinking = 归步
 *   步号)渲染为可折叠「思考 · 步骤 N」(Collapsible,默认收起——推理是
 *   次级信息);与同号步骤消息按到达序相邻。
 */
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type TextMessagePartComponent,
} from '@assistant-ui/react';

import { MarkdownText } from '@/components/assistant-ui/markdown-text';
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

/** assistant 文本部件:Markdown + flow 实例 rel 徽章(弱化呈现,纯展示)。 */
const AssistantText: TextMessagePartComponent = ({ text }) => {
  const rel = useMessageRel();
  const showRel = rel !== undefined && (rel.includes('flow') || text.includes('执行 next('));
  return (
    <span className="block">
      {showRel && (
        <Badge
          variant="outline"
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

/** 思考区条目(T11 Phase C):llm 步推理自述——次级信息,默认收起,展开读全文。 */
function ThinkingMessage({ step }: { step: number }) {
  return (
    <MessagePrimitive.Root className="flex w-full justify-start">
      <Collapsible className="max-w-[85%] rounded-lg border border-border px-3 py-1.5">
        <CollapsibleTrigger className="flex w-full items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground [&[data-state=open]>svg]:rotate-180">
          <ChevronDown className="h-3 w-3 transition-transform" />
          思考 · 步骤 {step}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1 text-xs text-muted-foreground">
          <MessagePrimitive.Parts components={{ Text: ThinkingText }} />
        </CollapsibleContent>
      </Collapsible>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  const thinkingStep = useMessageThinkingStep();
  // thinking 帧条目:可折叠思考区(与气泡步骤消息按到达序相邻)。
  if (thinkingStep !== undefined) {
    return <ThinkingMessage step={thinkingStep} />;
  }
  return (
    <MessagePrimitive.Root className="flex w-full justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm text-foreground">
        <MessagePrimitive.Parts components={{ Text: AssistantText }} />
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
            输入目标委托 agent(走 HTTP 合同),如「发布一篇文章」。
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
        {/* 委托模式开关(T5 Phase B):on→mode:'delegated' 派发 workflow。 */}
        <Button
          type="button"
          variant={delegated ? 'default' : 'secondary'}
          size="sm"
          aria-label="委托模式"
          data-nav="local:chat-delegated"
          aria-pressed={delegated}
          onClick={onToggleDelegated}
        >
          委托
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
