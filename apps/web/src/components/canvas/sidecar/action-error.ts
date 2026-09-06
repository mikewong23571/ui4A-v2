/** Render a server refusal without interpreting authorization or deciding whether to retry. */
export function sidecarFailureMessage(prefix: string, error: unknown, status: number): string {
  if (typeof error === 'string') return `${prefix}:${error}`;
  if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
    const fields = error as Record<string, unknown>;
    if (fields.code === 'presentation-responsibility-stale') {
      return '本次视图更改未保存：待处理事项必须保持清楚可见。请保留当前视图或选择其他调整。';
    }
    for (const key of ['message', 'detail', 'code']) {
      if (typeof fields[key] === 'string' && fields[key].trim() !== '') {
        return `${prefix}:${fields[key]}`;
      }
    }
  }
  return `${prefix}:HTTP ${status}${error == null ? '' : '（服务器未提供可读错误详情）'}`;
}
