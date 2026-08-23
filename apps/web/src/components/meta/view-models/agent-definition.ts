import type { SirenEntity } from '@ui4a/engine';

import { isRecord, numberValue, records, strings, text } from './value';

const SECRET_KEY = /(api[-_]?key|token|secret|credential|password|endpoint|env(?:ironment)?)/i;

/** Defense in depth for raw/generic disclosure; secret-shaped keys never render their values. */
export function redactMetaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMetaValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SECRET_KEY.test(key) ? '[redacted]' : redactMetaValue(child),
    ]),
  );
}

export function agentDefinitionViewModel(entity: SirenEntity) {
  const properties = entity.properties;
  const prompt = isRecord(properties.prompt) ? properties.prompt : {};
  const blocks = records(prompt.blocks);
  const authority = blocks
    .filter((block) => block.purpose === 'authority' || block.sealed === true)
    .map((block) => ({
      id: text(block.id),
      role: text(block.role),
      purpose: text(block.purpose),
      sealed: block.sealed === true,
      literal: text(block.literal),
    }));
  const bindings = blocks.flatMap((block) => {
    if (!isRecord(block.binding)) return [];
    return [
      {
        id: text(block.id),
        role: text(block.role),
        purpose: text(block.purpose),
        source: text(block.binding.source),
        pointer: text(block.binding.pointer),
        encoding: text(block.binding.encoding),
        required: block.binding.required === true,
      },
    ];
  });
  const policies = isRecord(properties.policies) ? properties.policies : {};
  const contracts = isRecord(properties.contracts) ? properties.contracts : {};
  const tools = isRecord(policies.tools) ? strings(policies.tools.allowed) : [];
  const resources = isRecord(policies.resources) ? strings(policies.resources.allowed) : [];
  return {
    ref: text(properties.ref),
    name: text(properties.name),
    version: numberValue(properties.version),
    status: text(properties.status),
    intent: text(properties.intent),
    runtime: {
      class: text(properties.runtimeClass),
      features: strings(properties.requiredFeatures),
    },
    authority,
    bindings,
    promptBlocks: blocks,
    inputSchema: contracts.inputSchema,
    outputSchema: contracts.outputSchema,
    tools,
    resources,
    artifactPolicy: policies.artifacts,
    evaluationPolicy: properties.evaluationPolicy,
    evaluation: properties.evaluation,
    hashes: properties.hashes,
    source: properties.source,
    flattened: properties.flattened,
  };
}
