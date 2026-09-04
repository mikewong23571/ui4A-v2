/**
 * `x-ui4a-payload-schemas` 注解的模型视图剥离(D69 T50 附录,prompt 预算冲突裁定)。
 *
 * 注解挂在 meta/drafts 动作 fields 顶层(D69.1 同门自披露),值 `{ <kind>:
 * { schema, example? } }`。模型视图(工具 schema 与认知投影 observation)只保留
 * `example`、剥离 per-kind `schema` 大对象——披露收窄发生在 prompt 层,HTTP 合同
 * 与 CLI/e2e 仍见全量注解(route.meta-parity.test.ts 以 HTTP 同载荷全量回放固定)。
 * 递归仅入该注解键内部一层(kind → 条目),不做通用 x- 剥离;注解值或条目非
 * `{ <kind>: record }` 形状(无 kind 条目的宽松分支)原样透传;源 schema 不改写。
 */

/** D69.1 注解关键字:meta/drafts 动作 fields 顶层自披露的 payload 合同。 */
export const PAYLOAD_SCHEMAS_ANNOTATION = 'x-ui4a-payload-schemas';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 模型视图动作字段:剥离注解中的 per-kind schema 大对象,保留 example。 */
export function stripPayloadSchemasForModelView(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const annotation = schema[PAYLOAD_SCHEMAS_ANNOTATION];
  if (!isRecord(annotation)) return schema;
  const kinds: Record<string, unknown> = {};
  for (const [kind, entry] of Object.entries(annotation)) {
    if (!isRecord(entry)) {
      kinds[kind] = entry;
      continue;
    }
    const stripped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (key !== 'schema') stripped[key] = value;
    }
    kinds[kind] = stripped;
  }
  return { ...schema, [PAYLOAD_SCHEMAS_ANNOTATION]: kinds };
}
