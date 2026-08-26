import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('delegation workflow explicit scope propagation', () => {
  it('requires scope on workflow and step args and forwards it unchanged to agentStep', () => {
    const source = readFileSync(new URL('./workflows.ts', import.meta.url), 'utf8');
    const workflowArgs = source.match(
      /export interface DelegationWorkflowArgs \{(?<body>[\s\S]*?)\n\}/,
    )?.groups?.body;
    const stepArgs = source.match(/export interface AgentStepArgs \{(?<body>[\s\S]*?)\n\}/)?.groups
      ?.body;
    const stepCall = source.match(/await agentStep\(\{(?<body>[\s\S]*?)\n\s*\}\);/)?.groups?.body;

    expect(workflowArgs).toMatch(/\bscope: string;/);
    expect(stepArgs).toMatch(/\bscope: string;/);
    expect(stepCall).toContain('scope: args.scope,');
  });
});
