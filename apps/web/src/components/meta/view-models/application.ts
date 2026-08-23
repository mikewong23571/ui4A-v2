import type { SirenEntity } from '@ui4a/engine';

import { isRecord, numberValue, records, text } from './value';

export interface ApplicationViewModel {
  name: string;
  title: string;
  intent: string;
  status: string;
  version: number;
  flows: { name: string; title: string; version?: number }[];
  capabilities: { name: string; title: string; kind: string }[];
  policies: { subject: string; mode: string }[];
  provenance?: Record<string, unknown>;
  readOnly: boolean;
}

/** Mechanical projection of the exact Application Siren entity; no policy or action is inferred. */
export function applicationViewModel(entity: SirenEntity): ApplicationViewModel {
  const properties = entity.properties;
  const bundle = isRecord(properties.bundle) ? properties.bundle : undefined;
  const bundleIdentity = bundle !== undefined && isRecord(bundle.bundle) ? bundle.bundle : {};
  const provenance =
    bundle !== undefined && isRecord(bundle.provenance) ? bundle.provenance : undefined;
  const versions = new Map(
    records(provenance?.flows).map((flow) => [text(flow.name), numberValue(flow.version)]),
  );
  const flows = records(bundle?.flows).map((flow) => {
    const name = text(flow.name);
    const version = versions.get(name);
    return {
      name,
      title: text(flow.title, name),
      ...(version === undefined || version === 0 ? {} : { version }),
    };
  });
  const capabilities = records(bundle?.capabilities).map((capability) => ({
    name: text(capability.name),
    title: text(capability.title, text(capability.name)),
    kind: text(capability.kind),
  }));
  const policies = records(bundle?.policies).map((policy) => ({
    subject: text(policy.subject),
    mode: isRecord(policy.submission) ? text(policy.submission.mode) : '',
  }));
  return {
    name: text(properties.name),
    title: text(properties.title, text(properties.name)),
    intent: text(properties.intent),
    status: text(properties.status, 'active'),
    version: numberValue(bundleIdentity.version, numberValue(properties.version, 1)),
    flows,
    capabilities,
    policies,
    ...(provenance === undefined ? {} : { provenance }),
    readOnly: entity.actions.length === 0,
  };
}
