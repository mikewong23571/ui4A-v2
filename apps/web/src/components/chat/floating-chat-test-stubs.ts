/**
 * 悬浮聊天窗测试共享桩(T23 Phase D 自 floating-chat.test.tsx 拆出):
 * jsdom 缺省 API 桩、JSON/SSE 响应桩与「展开聊天窗/发送目标」交互助手。
 * next/navigation 的 mock 与 beforeEach/afterEach 留在各测试文件
 * (vi.mock 按文件注册,不宜外移)。
 */
import { fireEvent, screen } from '@testing-library/react';

// assistant-ui 在浏览器用 ResizeObserver(jsdom 未实现;观测性桩足够渲染与交互)。
export class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** SSE 响应桩:帧序列一次性入队后关闭(客户端逐帧消费)。 */
export function sseResponse(frames: unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** 永不结束的 SSE 流(停止测试:running 态的确定性来源)。 */
export function hangingSseResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({ start: () => undefined });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

export function openChat(): void {
  fireEvent.click(screen.getByRole('button', { name: '展开聊天窗' }));
}

/** 输入目标并点发送。 */
export function sendGoal(goal: string): void {
  const input = screen.getByPlaceholderText('输入目标…') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: goal } });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
}
