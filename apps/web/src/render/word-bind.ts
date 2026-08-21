/**
 * 词条 bind 形状校验(T7 Phase B):bindSchema(Ajv)消费入口。
 *
 * 零字面校验器(validator.ts)剃掉了一切裸载荷;本校验器在其上收紧到
 * 词条级:哪个 prop 必须是集合节点、哪个必须是字段/实体引用节点——
 * 与目录 /api/render/catalog 同源(注册表 bindSchema 即目录 schema),
 * 画布渲染流与 spec 生成路径(Phase C)共用。纯函数,无 I/O。
 */
import Ajv, { type ValidateFunction } from 'ajv';

import type { RenderWordEntry } from './registry';
import { wordOf } from './registry';
import type { SpecError, SpecValidation } from './validator';

/** 每词条的编译产物(懒编译一次,进程内复用)。 */
const compiled = new Map<string, ValidateFunction>();

function validatorOf(word: RenderWordEntry): ValidateFunction {
  const existing = compiled.get(word.name);
  if (existing !== undefined) return existing;
  // strict:false——目录 schema 允许 description 等注记关键字;
  // allErrors:true——错误全量收集(与零字面校验器同口径)。
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(word.bindSchema) as ValidateFunction;
  compiled.set(word.name, validate);
  return validate;
}

/**
 * 校验 bind 树是否满足词条形状约束(词条须已过零字面校验;
 * 输入视为不可信,错误收集报告不抛错)。
 */
export function validateWordBind(bind: unknown, word: string): SpecValidation {
  const entry = wordOf(word);
  if (entry === undefined) {
    return {
      valid: false,
      errors: [{ path: 'component', message: `词条 "${word}" 不在渲染词汇表(目录 /api/render/catalog)` }],
    };
  }
  if (validatorOf(entry)(bind)) return { valid: true };
  const errors = (validatorOf(entry).errors ?? []).map<SpecError>((failure) => ({
    path: failure.instancePath === '' ? 'bind' : `bind${failure.instancePath}`,
    message: `${failure.message ?? '形状不满足词条 bindSchema'}(${word})`,
  }));
  return { valid: false, errors };
}
