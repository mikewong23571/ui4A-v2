/**
 * RJSF 校验器单例(:form runner 共用)。
 *
 * 引擎 schema.ts 对 textarea 字段派生 `format: "textarea"`(draft-07 非标准格式,
 * ajv 8 会对未注册格式打 "unknown format ignored" 告警)。RJSF 端 TextareaWidget
 * 本就按 format 名渲染控件,校验语义由 `type: string` 承担——这里把该格式注册为
 * 恒真,消除告警且不改变任何校验行为。
 */
import { customizeValidator } from '@rjsf/validator-ajv8';

export const rjsfValidator = customizeValidator({
  customFormats: {
    textarea: () => true,
  },
});
