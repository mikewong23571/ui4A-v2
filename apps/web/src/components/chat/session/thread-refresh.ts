import type { ClientViewReport } from '@ui4a/shared';
import { notifyThreadUpdated } from '../../canvas/desk/thread-desk-shared';

/** Freeze the request's explicit thread. A notification only requests a canonical reread. */
export function createChatThreadRefresh(view: ClientViewReport | undefined) {
  const thread = view?.presence.thread;
  const observed = new Set<'accepted' | 'settled'>();
  return (phase: 'accepted' | 'settled'): void => {
    if (thread === undefined || thread === null || observed.has(phase)) return;
    observed.add(phase);
    notifyThreadUpdated(thread.startsWith('thread:') ? thread : `thread:${thread}`);
  };
}
