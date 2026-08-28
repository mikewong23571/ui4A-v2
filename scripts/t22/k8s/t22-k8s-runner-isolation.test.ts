import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const chartRoot = resolve(repositoryRoot, 'deploy/helm/ui4a');

describe('T22 K8s dynamic Runner scoped Secret contract', () => {
  it('declares an external scoped Runner Secret and key without material', () => {
    const values = readFileSync(resolve(chartRoot, 'values.yaml'), 'utf8');
    const schema = readFileSync(resolve(chartRoot, 'values.schema.json'), 'utf8');

    expect(values).toContain('runnerExistingSecretName: ui4a-runner-secrets');
    expect(values).toContain('runnerSecretsKey: runner-secrets.json');
    expect(schema).toContain('runnerExistingSecretName');
    expect(schema).toContain('runnerSecretsKey');
    expect(values).not.toMatch(/llm-api-key:\s*\S+/);
  });

  it('injects only the server-owned scoped Secret reference into the Worker transport', () => {
    const template = readFileSync(resolve(chartRoot, 'templates/deployments.yaml'), 'utf8');
    expect(template).toMatch(
      /UI4A_KUBERNETES_SECRETS_SECRET[^\n]+\.Values\.secrets\.runnerExistingSecretName/,
    );
    expect(template).toMatch(
      /UI4A_KUBERNETES_SECRETS_KEY[^\n]+\.Values\.secrets\.runnerSecretsKey/,
    );
    expect(template).not.toMatch(
      /UI4A_KUBERNETES_SECRETS_SECRET[^\n]+\.Values\.secrets\.existingSecretName/,
    );

    const renderer = readFileSync(resolve(chartRoot, 'workloads.ts'), 'utf8');
    expect(renderer).toMatch(
      /name: 'UI4A_KUBERNETES_SECRETS_SECRET',[\s\S]{0,100}value: values\.secrets\.runnerExistingSecretName/,
    );
    expect(renderer).toMatch(
      /name: 'UI4A_KUBERNETES_SECRETS_KEY',[\s\S]{0,100}value: values\.secrets\.runnerSecretsKey/,
    );
  });
});
