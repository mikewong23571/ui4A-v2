'use client';
import { useAui, useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';

/** Copy only: a failed run may already have effects, so execution always needs a new human send. */
export function EditFailedQuestion() {
  const aui = useAui();
  const question = useAuiState((state) => {
    const index = state.thread.messages.findIndex((message) => message.id === state.message.id);
    for (let i = index - 1; i >= 0; i -= 1) {
      const message = state.thread.messages[i]!;
      if (message.role === 'user') {
        return message.content
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('\n');
      }
    }
    return undefined;
  });
  const running = useAuiState((state) => state.thread.isRunning);
  const hasDraft = useAuiState(
    (state) =>
      state.thread.composer.text.length > 0 || state.thread.composer.attachments.length > 0,
  );
  if (question === undefined) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={running || hasDraft}
      title={hasDraft ? '请先处理输入框中的草稿' : '将这轮原问题放入输入框，修改后由你发送'}
      onClick={() => {
        const composer = aui.thread.composer();
        const current = composer.getState();
        if (
          aui.thread.getState().isRunning ||
          current.text.length > 0 ||
          current.attachments.length > 0
        )
          return;
        composer.setText(question);
      }}
    >
      修改后再试
    </Button>
  );
}
