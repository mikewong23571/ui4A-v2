/** Generic structural validation cues. Business rejection remains the server's own receipt. */
interface ValidationError {
  name?: string;
  property?: string;
  message?: string;
  stack: string;
  title?: string;
  params?: Record<string, unknown>;
}

export function localizeActionErrors<T extends ValidationError>(errors: T[]): T[] {
  return errors.map((error) => {
    const title = error.title || error.property || '此项';
    const label = `“${title}”`;
    let message: string;
    switch (error.name) {
      case 'required':
        message = `请填写${label}。`;
        break;
      case 'minLength':
        message = `${label}至少填写 ${String(error.params?.limit)} 个字符。`;
        break;
      case 'maxLength':
        message = `${label}最多填写 ${String(error.params?.limit)} 个字符。`;
        break;
      case 'enum':
      case 'oneOf':
        message = `请为${label}选择一个有效值。`;
        break;
      case 'minimum':
        message = `${label}不能小于 ${String(error.params?.limit)}。`;
        break;
      case 'maximum':
        message = `${label}不能大于 ${String(error.params?.limit)}。`;
        break;
      default:
        message = `请检查${label}的格式。`;
    }
    return { ...error, message, stack: message };
  });
}

/** Keep raw validator diagnostics available on demand without repeating English on the task face. */
export function ActionErrorList({ errors }: { errors: ValidationError[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="mb-3 text-sm">
      <p role="alert">请检查下方标出的输入。</p>
      <details className="mt-1 text-xs text-muted-foreground">
        <summary>校验详情</summary>
        <pre className="overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(
            errors.map(({ name, property, params }) => ({ name, property, params })),
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
