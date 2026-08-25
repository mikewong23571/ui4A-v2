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

/**
 * 可续写 SSE 流(T24 Phase B 进行中思考指示测试):初始帧先行入队,流保持
 * 打开;push 按需续帧,close 收尾(客户端读到流结束才把回合置为已完成)。
 */
export function scriptedSseResponse(initial: unknown[]): {
  response: Response;
  push: (frame: unknown) => void;
  close: () => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const frame of initial) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
    push: (frame: unknown) => {
      if (closed) return;
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
    },
    // 幂等:收尾与测试 finally 双调用均安全。
    close: () => {
      if (closed) return;
      closed = true;
      controller?.close();
    },
  };
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
