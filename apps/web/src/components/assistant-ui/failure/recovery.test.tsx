// @vitest-environment jsdom
import { AssistantRuntimeProvider, useExternalStoreRuntime } from '@assistant-ui/react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatThread } from '../thread';
import { convertMessage, type ChatUiMessage } from '@/components/chat/chat-types';
import { ResizeObserverStub } from '@/components/chat/floating-chat-test-stubs';

const onNew = vi.fn();
const messages: ChatUiMessage[] = [
  { role: 'user', content: '第一轮原问题' },
  {
    role: 'assistant',
    content: 'provider raw 1',
    failure: { code: 'driver_fail', evidence: ['provider raw 1'] },
  },
  { role: 'user', content: '第二轮原问题' },
  {
    role: 'assistant',
    content: 'provider raw 2',
    failure: { code: 'driver_fail', evidence: ['provider raw 2'] },
  },
];
function Harness({ running = false }: { running?: boolean }) {
  const runtime = useExternalStoreRuntime({ messages, isRunning: running, onNew, convertMessage });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatThread delegated={false} onToggleDelegated={() => {}} />
    </AssistantRuntimeProvider>
  );
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Element.prototype.scrollTo = () => undefined;
  onNew.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('keeps provider detail folded and copies the corresponding earlier question without sending', () => {
  render(<Harness />);
  expect(screen.getAllByText('本次未完成')).toHaveLength(2);
  const raw = screen.getByText('provider raw 1');
  expect(raw.closest('details')?.open).toBe(false);
  fireEvent.click(screen.getAllByRole('button', { name: '修改后再试' })[0]!);
  expect((screen.getByPlaceholderText('输入目标…') as HTMLTextAreaElement).value).toBe(
    '第一轮原问题',
  );
  expect(onNew).not.toHaveBeenCalled();
});

it('preserves an existing unsent draft', () => {
  render(<Harness />);
  const input = screen.getByPlaceholderText('输入目标…') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: '正在写的新草稿' } });
  const edit = screen.getAllByRole('button', { name: '修改后再试' })[1] as HTMLButtonElement;
  expect(edit.disabled).toBe(true);
  fireEvent.click(edit);
  expect(input.value).toBe('正在写的新草稿');
  expect(onNew).not.toHaveBeenCalled();
});

it('does not offer editing into the composer while another turn is running', () => {
  render(<Harness running />);
  for (const button of screen.getAllByRole('button', { name: '修改后再试' })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  }
  expect(onNew).not.toHaveBeenCalled();
});
