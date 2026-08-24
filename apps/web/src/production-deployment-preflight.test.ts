import { describe, expect, it } from 'vitest';

import { runWebProductionDeploymentPreflight } from './production-deployment-preflight';

describe('Web production deployment startup preflight', () => {
  it('preserves local demo startup even when Next sets NODE_ENV=production for a build', () => {
    expect(runWebProductionDeploymentPreflight({ NODE_ENV: 'production' })).toBeUndefined();
  });

  it('fails before startup when the explicit production profile is incomplete', () => {
    expect(() =>
      runWebProductionDeploymentPreflight({ UI4A_DEPLOYMENT_PROFILE: 'production' }),
    ).toThrow(/settings|UI4A_DEPLOYMENT_SETTINGS/i);
  });
});
