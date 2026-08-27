import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ChatTurnDetail } from '../../../chat/history';

const routeSource = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const chatSituationSource = readFileSync(
  new URL('../../../engine/chat-situation.ts', import.meta.url),
  'utf8',
);

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
    expect(routeSource).toContain('principal: args.presentationPrincipal');
    expect(routeSource).toContain('sourceMessageIds: [turnId]');
    expect(routeSource).toContain('presentationRequestIds');
    // granted scope 集合下穿管线:chat 入口经 presentationContextForIdentity 把全量
    // granted scopes(identity.scopes 提取 + policyScope 兜底)随可信上下文交给
    // Broker,目标 rel 的覆盖选择由 Broker 授权点完成;local profile 维持 local-demo。
    expect(routeSource).toContain('presentationContextForIdentity(productionIdentity)');
    expect(routeSource).toContain('presentationContext,');
    expect(chatSituationSource).toContain('grantedPolicyScopes(identity.scopes)');
    expect(chatSituationSource).toContain("return { policyScope: 'local-demo' }");
    expect(routeSource).not.toMatch(/completePresentationRequest\(intent,[\s\S]{0,300}policyScope/);

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
    expect(JSON.stringify(history)).not.toContain('policyScope');
  });

  it('keeps Chat outcome independent while settling governed Presentation jobs before stream close', () => {
    expect(routeSource).toMatch(
      /getPresentationBroker\(\)[\s\S]*?\.present\(request, args\.presentationContext\)/,
    );
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
