import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ChatTurnDetail } from '../../../chat/history';

const routeSource = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

describe('T16 Chat/Presentation source governance', () => {
  it('contains no keyword renderer, business-specific display route, or catalog planning context', () => {
    for (const forbidden of [
      'hasDisplayIntent',
      'entityFocusForDisplayIntent',
      'renderSpecFor',
      'generateRenderSpecWithLlm',
      'renderWordSummaries',
      'RENDER_WORDS',
      'validateWordBind',
      'freezeSpec(',
    ]) {
      expect(routeSource, forbidden).not.toContain(forbidden);
    }
  });

  it('completes model intent with trusted request metadata and stores references only', () => {
    expect(routeSource).toContain('completePresentationRequest(intent');
    expect(routeSource).toContain('principal: PRESENTATION_PRINCIPAL');
    expect(routeSource).toContain('sourceMessageIds: [turnId]');
    expect(routeSource).toContain('presentationRequestIds');

    const history: ChatTurnDetail = {
      sessionId: 'session:a',
      turnId: 'turn:a',
      goal: { verb: '看看第一篇' },
      outcome: 'answered',
      summary: '第一篇用于验证阅读。',
      messages: [],
      steps: [],
      presentationRequestIds: ['turn:a:presentation:1'],
      driver: 'llm',
    };
    expect(JSON.stringify(history)).not.toMatch(/surfaceTree|catalog|dependencies|hydration/i);
  });

  it('keeps Chat outcome independent while settling governed Presentation jobs before stream close', () => {
    expect(routeSource).toMatch(/getPresentationBroker\(\)[\s\S]*?\.present\(request\)/);
    expect(routeSource).toContain('presentationJobs.push(job)');
    expect(routeSource).toMatch(
      /send\(\{[\s\S]*?type: 'final'[\s\S]*?await Promise\.allSettled\(presentationJobs\)/,
    );
    expect(routeSource).toMatch(
      /await appendNavigationCompletion\([\s\S]*?send\(\{ type: 'presentation'/,
    );
    expect(routeSource).toContain('chatMarkdown: true');
  });
});
