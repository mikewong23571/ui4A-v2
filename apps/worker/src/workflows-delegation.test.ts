import { beforeEach, describe, expect, it, vi } from 'vitest';

const activities = vi.hoisted(() => ({
  startDelegation: vi.fn(),
  loadSitemap: vi.fn(),
  agentStep: vi.fn(),
  finishDelegation: vi.fn(),
}));

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: () => activities,
  workflowInfo: () => ({ workflowId: 'context-birth-pinned' }),
  defineSignal: (name: string) => name,
}));

import { delegationWorkflow } from './workflows';

beforeEach(() => {
  vi.clearAllMocks();
  activities.agentStep.mockReset();
});

describe('delegation workflow working context', () => {
  it('starts at application discovery without an application preference', async () => {
    activities.agentStep.mockResolvedValue({
      op: { kind: 'answer', content: 'Available applications', sources: [] },
      outcome: 'answered',
    });

    await delegationWorkflow({
      goal: { verb: '有哪些能力' },
      driverKind: 'llm',
      baseUrl: 'http://contract.test',
    });

    expect(activities.agentStep.mock.calls[0]![0]).toMatchObject({ currentRel: 'applications' });
    expect(activities.agentStep.mock.calls[0]![0].scope).toBeUndefined();
    expect(activities.loadSitemap).not.toHaveBeenCalled();
  });

  it('pins the workline reference across navigation and keeps live facts out of workflow state', async () => {
    activities.agentStep
      .mockResolvedValueOnce({
        op: { kind: 'navigate', rel: 'post:release' },
        outcome: 'navigated',
      })
      .mockResolvedValueOnce({
        op: { kind: 'answer', content: 'Done', sources: [] },
        outcome: 'answered',
      });

    await delegationWorkflow({
      goal: { verb: '这件事进展如何' },
      driverKind: 'llm',
      baseUrl: 'http://contract.test',
      contextRel: 'thread:release',
      startRel: 'thread:release',
    });

    expect(activities.agentStep).toHaveBeenCalledTimes(2);
    for (const [args] of activities.agentStep.mock.calls) {
      expect(args.contextRel).toBe('thread:release');
      expect(args).not.toHaveProperty('sitemap');
      expect(args).not.toHaveProperty('workingContext');
    }
    expect(activities.agentStep.mock.calls[1]![0].currentRel).toBe('post:release');
    expect(activities.startDelegation.mock.calls[0]![0]).toMatchObject({
      contextRel: 'thread:release',
    });
  });
});
