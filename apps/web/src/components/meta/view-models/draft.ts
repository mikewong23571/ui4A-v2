import type { SirenEntity } from '@ui4a/engine';

import { isRecord, numberValue, records, strings, text } from './value';

export function draftViewModel(entity: SirenEntity) {
  const properties = entity.properties;
  const validation = isRecord(properties.validation) ? properties.validation : {};
  const provenance = isRecord(properties.provenance) ? properties.provenance : {};
  const checks = records(properties.checks)
    .map((check) => ({
      name: text(check.name),
      pass: check.pass === true,
      detail: Array.isArray(check.detail) ? check.detail : [],
    }))
    .sort((left, right) => Number(left.pass) - Number(right.pass));
  return {
    rel: text(properties.rel),
    id: text(properties.id),
    owner: text(properties.owner),
    policyScope: text(properties.policyScope),
    kind: text(properties.kind),
    target: text(properties.target),
    status: text(properties.status),
    version: numberValue(properties.version),
    maxVersion: numberValue(properties.maxVersion),
    expiresAt: text(properties.expiresAt),
    issues: records(validation.issues).map((issue) => ({
      code: text(issue.code),
      path: text(issue.path),
      message: text(issue.message),
    })),
    checks,
    evaluation: properties.evaluation,
    sources: strings(provenance.sources),
    provenance,
    diff: properties.diff,
    payload: properties.payload,
    payloadHash: text(properties.payloadHash),
    terminalReason: text(properties.terminalReason),
    actions: entity.actions
      .filter((action) => action.href === '/_meta/api/exec' && !action.name.includes('callback'))
      .map((action) => action.name),
  };
}
