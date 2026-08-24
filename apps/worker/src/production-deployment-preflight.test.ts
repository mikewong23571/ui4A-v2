import { describe, expect, it } from 'vitest';

import { runWorkerProductionDeploymentPreflight } from './production-deployment-preflight';

describe('Worker production deployment startup preflight', () => {
  it('preserves the existing local demo when production is not explicitly selected', () => {
    expect(runWorkerProductionDeploymentPreflight({ NODE_ENV: 'production' })).toBeUndefined();
  });

  it('fails before Temporal connection when explicit production configuration is incomplete', () => {
    expect(() =>
      runWorkerProductionDeploymentPreflight({ UI4A_DEPLOYMENT_PROFILE: 'production' }),
    ).toThrow(/settings|UI4A_DEPLOYMENT_SETTINGS/i);
  });
});
