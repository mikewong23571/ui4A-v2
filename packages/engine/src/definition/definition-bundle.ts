import type {
  ApplicationDefinition,
  CapabilityDefinition,
  EngineSnapshot,
  FlowDefinition,
  SubmissionPolicy,
} from '@ui4a/shared';

import { activeDefinitionOf } from './meta';
import {
  parseApplicationDefinition,
  parseCapabilityDefinition,
  parseFlowDefinition,
} from '../core/parse';

export const DEFINITION_BUNDLE_SCHEMA =
  'https://ui4a.dev/application-definition-bundle/v1' as const;

export interface ApplicationDefinitionBundle {
  schema: typeof DEFINITION_BUNDLE_SCHEMA;
  bundle: { name: string; version: number };
  applications: ApplicationDefinition[];
  capabilities: CapabilityDefinition[];
  flows: FlowDefinition[];
  policies: { subject: string; submission: SubmissionPolicy }[];
  provenance: {
    source: 'active-definition-log';
    application: string;
    flows: { name: string; version: number }[];
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the editable definition-only Bundle. Runtime seed/facts are intentionally not accepted. */
export function parseDefinitionBundle(input: unknown): ApplicationDefinitionBundle {
  if (!record(input) || input.schema !== DEFINITION_BUNDLE_SCHEMA) {
    throw new Error(`definition bundle schema must be ${DEFINITION_BUNDLE_SCHEMA}`);
  }
  if (!record(input.bundle) || typeof input.bundle.name !== 'string') {
    throw new Error('definition bundle bundle.name is required');
  }
  if (!Number.isSafeInteger(input.bundle.version) || (input.bundle.version as number) < 1) {
    throw new Error('definition bundle bundle.version must be a positive integer');
  }
  if (
    !Array.isArray(input.applications) ||
    !Array.isArray(input.capabilities) ||
    !Array.isArray(input.flows)
  ) {
    throw new Error('definition bundle applications/capabilities/flows must be arrays');
  }
  if (!Array.isArray(input.policies) || !record(input.provenance)) {
    throw new Error('definition bundle policies/provenance are required');
  }
  const applications = input.applications.map(parseApplicationDefinition);
  const capabilities = input.capabilities.map(parseCapabilityDefinition);
  const flows = input.flows.map(parseFlowDefinition);
  const policies = input.policies.map((row, index) => {
    if (!record(row) || typeof row.subject !== 'string' || !record(row.submission)) {
      throw new Error(`definition bundle policies[${index}] is invalid`);
    }
    const mode = row.submission.mode;
    if (mode !== 'draft' && mode !== 'direct' && mode !== 'none') {
      throw new Error(`definition bundle policies[${index}].submission.mode is invalid`);
    }
    return { subject: row.subject, submission: row.submission as unknown as SubmissionPolicy };
  });
  const flowVersions = input.provenance.flows;
  if (
    input.provenance.source !== 'active-definition-log' ||
    typeof input.provenance.application !== 'string' ||
    !Array.isArray(flowVersions)
  ) {
    throw new Error('definition bundle provenance is invalid');
  }
  return {
    schema: DEFINITION_BUNDLE_SCHEMA,
    bundle: { name: input.bundle.name, version: input.bundle.version as number },
    applications,
    capabilities,
    flows,
    policies,
    provenance: {
      source: 'active-definition-log',
      application: input.provenance.application,
      flows: flowVersions.map((row, index) => {
        if (!record(row) || typeof row.name !== 'string' || !Number.isSafeInteger(row.version)) {
          throw new Error(`definition bundle provenance.flows[${index}] is invalid`);
        }
        return { name: row.name, version: row.version as number };
      }),
    },
  };
}

/** Project one active Application as a canonical editable Bundle without runtime facts. */
export function exportDefinitionBundle(
  snapshot: EngineSnapshot,
  applicationName: string,
): ApplicationDefinitionBundle {
  const application = snapshot.applications?.[applicationName];
  if (application === undefined) throw new Error(`application ${applicationName} does not exist`);
  const entries = Object.values(snapshot.definitions ?? {}).filter(
    (entry) => (activeDefinitionOf(snapshot, entry.name)?.app ?? 'default') === applicationName,
  );
  const flows = entries
    .map((entry) => activeDefinitionOf(snapshot, entry.name)!)
    .map(parseFlowDefinition);
  const capabilityNames = new Set<string>();
  for (const flow of flows) {
    const serialized = JSON.stringify(flow);
    for (const name of Object.keys(snapshot.capabilities ?? {})) {
      if (serialized.includes(`"${name}"`)) capabilityNames.add(name);
    }
  }
  const capabilities = [...capabilityNames]
    .map((name) => snapshot.capabilities![name]!)
    .map(parseCapabilityDefinition);
  return {
    schema: DEFINITION_BUNDLE_SCHEMA,
    bundle: {
      name: applicationName,
      version: Math.max(1, ...entries.map((entry) => entry.version)),
    },
    applications: [parseApplicationDefinition(application)],
    capabilities,
    flows,
    policies: [
      {
        subject: `application:${applicationName}`,
        submission: application.submission ?? { mode: 'draft' },
      },
      ...flows.flatMap((flow) => [
        { subject: `flow:${flow.name}`, submission: flow.submission ?? { mode: 'draft' as const } },
        ...flow.nodes.flatMap((node) =>
          node.actions.flatMap((action) =>
            action.submission === undefined
              ? []
              : [
                  {
                    subject: `flow:${flow.name}/node:${node.name}/action:${action.name}`,
                    submission: action.submission,
                  },
                ],
          ),
        ),
      ]),
    ],
    provenance: {
      source: 'active-definition-log',
      application: applicationName,
      flows: entries.map((entry) => ({ name: entry.name, version: entry.version })),
    },
  };
}
