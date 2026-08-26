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
  } catch {
    return 'skipped';
  }
}
