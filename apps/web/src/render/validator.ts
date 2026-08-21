/**
 * 零字面校验器(binding-only 剃刀的 schema 侧,T7 spec 架构决定 2)。
 *
 * "模型发不出一个数字":递归走 BindTree,出现裸 number/string/boolean/
 * null 载荷(或引用节点格式/形状违规)→ invalid,错误带路径与原因
 * (注入防御的审计口径:S5 断言 spec JSON 递归无裸载荷即本校验器通过)。
 *
 * 白名单键 = 引用声明本身(ref/field/collection/dimension 的字符串取值
 * 是"指向哪"的声明,不是内容载荷);结构容器的键是词条 props 的结构名
 * (选,不是画),值必须仍是 bind 树。纯函数,无 I/O。
 */
import { ENTITY_REF_PREFIX, parseFieldRef, type BindTree } from './spec';

/** 校验错误(路径 + 原因;路径口径:bind.value / bind.rows[2].cells[0])。 */
export interface SpecError {
  path: string;
  message: string;
}

export type SpecValidation = { valid: true } | { valid: false; errors: SpecError[] };

const REF_KEYS = ['ref', 'field', 'collection'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** bind 节点走查:错误就地收集(路径前缀 'bind')。 */
function validateBind(bind: unknown, path: string, errors: SpecError[]): void {
  if (typeof bind === 'number' || typeof bind === 'boolean' || bind === null) {
    errors.push({
      path,
      message: `裸${bind === null ? ' null' : typeof bind}字面载荷 "${String(bind)}" 违规:bind 只允许实体引用与结构容器(binding-only)`,
    });
    return;
  }
  if (typeof bind === 'string') {
    errors.push({
      path,
      message: `裸字符串字面载荷 "${bind}" 违规:bind 只允许实体引用与结构容器(binding-only)`,
    });
    return;
  }
  if (Array.isArray(bind)) {
    bind.forEach((child, index) => validateBind(child, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(bind)) {
    errors.push({ path, message: `未知节点形状 ${String(bind)}` });
    return;
  }

  const present = REF_KEYS.filter((key) => key in bind);
  if (present.length > 0) {
    // 引用节点:必须恰是一种引用;ref/field/collection 各自校验取值格式;
    // 混入其他键(含另一种引用键)一律违规——节点含义必须无歧义。
    const allowed: Record<string, readonly string[]> = {
      ref: ['ref'],
      field: ['field'],
      collection: ['collection', 'dimension'],
    };
    const kind = present[0]!;
    const allowedKeys = allowed[kind]!;
    for (const key of Object.keys(bind)) {
      if (!allowedKeys.includes(key)) {
        errors.push({
          path: path === 'bind' ? `bind.${key}` : `${path}.${key}`,
          message: `引用节点(${kind})混入非法键 "${key}":引用节点只允许 ${allowedKeys.join('/')}`,
        });
      }
    }
    if (present.length > 1) {
      errors.push({
        path,
        message: `引用节点混用多种引用键(${present.join('+')}):必须恰是一种`,
      });
    }
    if (kind === 'ref') {
      const ref = bind.ref;
      if (
        typeof ref !== 'string' ||
        !ref.startsWith(ENTITY_REF_PREFIX) ||
        ref.slice(ENTITY_REF_PREFIX.length) === ''
      ) {
        errors.push({
          path: path === 'bind' ? 'bind.ref' : `${path}.ref`,
          message: `实体引用格式非法 "${String(ref)}"(应为 "${ENTITY_REF_PREFIX}<rel>")`,
        });
      }
    }
    if (kind === 'field') {
      if (typeof bind.field !== 'string' || parseFieldRef(bind.field) === undefined) {
        errors.push({
          path: path === 'bind' ? 'bind.field' : `${path}.field`,
          message: `字段引用格式非法 "${String(bind.field)}"(应为 "<rel>.<path>" 且两段非空)`,
        });
      }
    }
    if (kind === 'collection') {
      if (typeof bind.collection !== 'string' || bind.collection === '') {
        errors.push({
          path: path === 'bind' ? 'bind.collection' : `${path}.collection`,
          message: `集合引用格式非法 "${String(bind.collection)}"(应非空)`,
        });
      }
      const dimension = bind.dimension;
      if (dimension !== undefined) {
        if (typeof dimension !== 'string') {
          errors.push({
            path: path === 'bind' ? 'bind.dimension' : `${path}.dimension`,
            message: '维度声明必须是 field-ref 字符串',
          });
        } else {
          const parsed = parseFieldRef(dimension);
          if (parsed === undefined) {
            errors.push({
              path: path === 'bind' ? 'bind.dimension' : `${path}.dimension`,
              message: `维度声明格式非法 "${dimension}"(应为 "<collection>.<path>")`,
            });
          } else if (
            typeof bind.collection === 'string' &&
            bind.collection !== '' &&
            parsed.rel !== bind.collection
          ) {
            errors.push({
              path: path === 'bind' ? 'bind.dimension' : `${path}.dimension`,
              message: `维度声明的 rel 前缀 "${parsed.rel}" 与所属 collection "${bind.collection}" 不一致`,
            });
          }
        }
      }
    }
    return;
  }

  // 结构字典:值必须仍是 bind 树(键是 props 结构名,不校验白名单——
  // 词条级形状约束在注册表 bindSchema,Phase B 接入组件时收紧)。
  for (const [key, child] of Object.entries(bind)) {
    validateBind(child, path === 'bind' ? `bind.${key}` : `${path}.${key}`, errors);
  }
}

/**
 * 校验 render spec(结构 + 零字面)。纯函数;spec 视为不可信输入
 * (agent/生成路径产物),任何形状违规都收集报告,不抛错。
 */
export function validateSpec(spec: unknown): SpecValidation {
  const errors: SpecError[] = [];
  if (!isRecord(spec)) {
    return { valid: false, errors: [{ path: 'spec', message: 'spec 必须是对象' }] };
  }
  if (typeof spec.concern !== 'string' || spec.concern === '') {
    errors.push({ path: 'concern', message: 'concern 必须是非空字符串(凝固键)' });
  }
  if (typeof spec.component !== 'string' || spec.component === '') {
    errors.push({ path: 'component', message: 'component 必须是非空词名' });
  }
  if (!('bind' in spec)) {
    errors.push({ path: 'bind', message: '缺少 bind 绑定树' });
  } else {
    validateBind(spec.bind, 'bind', errors);
  }
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
