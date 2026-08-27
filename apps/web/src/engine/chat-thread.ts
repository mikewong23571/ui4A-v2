import { THREAD_REL_PREFIX, type ExecRequest } from '@ui4a/engine';
import type { EngineSnapshot } from '@ui4a/shared';

interface ThreadExecReader {
  getSnapshot(): EngineSnapshot;
  readSnapshot(): Promise<EngineSnapshot>;
  exec(request: ExecRequest): Promise<{ kind: string }>;
}

/** Explicitly attach one persisted user message to the currently anchored owned thread. */
export async function attachChatMessageToThread(
  engine: ThreadExecReader,
  args: { thread: string | null; principal: string; messageId: string },
): Promise<'attached' | 'skipped'> {
  if (args.thread === null || args.thread === '') return 'skipped';
  const id = args.thread.startsWith(THREAD_REL_PREFIX)
    ? args.thread.slice(THREAD_REL_PREFIX.length)
    : args.thread;
  try {
    const thread = (await engine.readSnapshot()).threads?.[id];
    if (thread === undefined || thread.owner !== args.principal) return 'skipped';
    const outcome = await engine.exec({
      rel: `${THREAD_REL_PREFIX}${id}`,
      action: 'attach',
      actor: 'human',
      principal: args.principal,
      channel: 'chat-presence',
      params: { category: 'context', rel: `message:${args.messageId}` },
    });
    return outcome.kind === 'accepted' ? 'attached' : 'skipped';
  } catch (error) {
    // R6:挂接是尽力而为的投影接线,chat 不阻断(D44)——正常 skip 路径保持静默;
    // 只有 try 内抛出的真异常(readSnapshot/exec throw,如存储故障)记一条
    // 结构化日志留可观测性,然后仍按 skipped 收口。
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[ui4a] chat 消息挂接 Work Thread 失败(尽力而为,聊天不受影响;messageId=${args.messageId}, thread=${args.thread}): ${message}`,
    );
    return 'skipped';
  }
}
