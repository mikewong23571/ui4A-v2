/**
 * 字段级定义校验(T38 FR4 自 parse.ts 拆出,GR3 沿功能边界分解):
 * 字段名/类型/persist/presentation(含概览显示 hint overview)/
 * contentMediaType/select options 的逐项校验;issues 全量收集(拒绝即教育)。
 */
import { KNOWN_FIELD_TYPES } from '@ui4a/shared';

import type { FieldDefinition, FieldType } from './types';
import type { FlowIssue } from './parse';

const FIELD_TYPES: ReadonlySet<FieldType> = KNOWN_FIELD_TYPES;

const FIELD_PRESENTATION_ROLES: ReadonlySet<string> = new Set([
  'identity',
  'status',
  'primary-content',
  'metadata',
  'relation',
]);

export function validateFields(fields: FieldDefinition[], path: string, issues: FlowIssue[]): void {
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    const fieldPath = `${path}[${field.name ?? index}]`;
    if (seen.has(field.name)) {
      issues.push({ path: fieldPath, message: '存在重复字段名' });
    }
    seen.add(field.name);
    if (typeof field.name !== 'string' || field.name === '') {
      issues.push({ path: fieldPath, message: '字段 name 必须是非空字符串' });
    }
    if (!FIELD_TYPES.has(field.type)) {
      issues.push({ path: `${fieldPath}.type`, message: `未知字段类型 "${String(field.type)}"` });
    }
    if (field.persist !== undefined && typeof field.persist !== 'boolean') {
      issues.push({ path: `${fieldPath}.persist`, message: 'persist 必须是 boolean' });
    }
    if (
      field.presentation !== undefined &&
      (typeof field.presentation !== 'object' ||
        field.presentation === null ||
        !FIELD_PRESENTATION_ROLES.has(field.presentation.role))
    ) {
      issues.push({
        path: `${fieldPath}.presentation.role`,
        message: '未知字段呈现角色',
      });
    }
    // 概览显示 hint(T38 FR4):布尔标志住在字段声明上,引用未声明字段不可表达。
    if (
      field.presentation !== undefined &&
      typeof field.presentation === 'object' &&
      field.presentation !== null &&
      field.presentation.overview !== undefined &&
      typeof field.presentation.overview !== 'boolean'
    ) {
      issues.push({
        path: `${fieldPath}.presentation.overview`,
        message: 'overview 必须是 boolean',
      });
    }
    if (
      field.contentMediaType !== undefined &&
      (typeof field.contentMediaType !== 'string' || field.contentMediaType.trim() === '')
    ) {
      issues.push({
        path: `${fieldPath}.contentMediaType`,
        message: 'contentMediaType 必须是非空字符串',
      });
    }
    if (field.type === 'select' && (!field.options || field.options.length === 0)) {
      issues.push({
        path: `${fieldPath}.options`,
        message: 'select 字段必须声明非空 options',
      });
    }
  });
}
