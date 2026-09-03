/**
 * application-bundle Draft 纯校验器(T48 Phase 1 / T1.2)。
 *
 * 把安装边界的 parseApplicationBundle 适配为 Draft 校验合同:unknown payload →
 * {valid, issues, value};解析失败是 invalid + issues(拒绝是有理由的事件,
 * 不是异常),永不 throw。安装语义(planMetaBootstrap)属于激活阶段(T48
 * Phase 2),本模块只回答"这份制品是否是一份完整可安装的 bundle"。
 */
import type { DraftValidation } from '@ui4a/shared';

import { parseApplicationBundle, type ApplicationBundle } from '../meta-bootstrap';

export interface ApplicationBundleDraftValidation extends DraftValidation {
  value?: ApplicationBundle;
}

/** Parse and validate an application bundle candidate without planning installation. */
export function validateApplicationBundleDraft(payload: unknown): ApplicationBundleDraftValidation {
  let value: ApplicationBundle;
  try {
    value = parseApplicationBundle(payload);
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          code: 'parse-error',
          path: '/',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  return { valid: true, issues: [], value };
}
