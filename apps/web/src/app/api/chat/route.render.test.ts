import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ChatTurnDetail } from '../../../chat/history';

// T36 B1 拆分:SSE 流内编排(含 Presentation 接线)自 route.ts 提取至
// chat/inline-stream.ts;源码不变量断言随 wiring 归属分别锚定两文件。
const routeSource = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const streamSource = readFileSync(
  new URL('../../../chat/inline-stream.ts', import.meta.url),
  'utf8',
);
const chatSituationSource = readFileSync(
  new URL('../../../engine/chat-situation.ts', import.meta.url),
  'utf8',
);

describe('T16 Chat/Presentation source governance', () => {
  it('contains no keyword renderer, business-specific display route, or catalog planning context', () => {
    for (const source of [routeSource, streamSource]) {
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
        expect(source, forbidden).not.toContain(forbidden);
      }
    }
  });

  it('completes model intent with trusted request metadata and stores references only', () => {
    expect(streamSource).toContain('completePresentationRequest(intent');
    expect(streamSource).toContain('principal: args.presentationPrincipal');
    expect(streamSource).toContain('sourceMessageIds: [turnId]');
    expect(streamSource).toContain('presentationRequestIds');
    // D51 新管线特征:chat 入口经 presentationContextForIdentity 把凭证授予集合
    // (grantedApplications)随可信上下文交给 Broker,授权由咽喉点按授予集合 ×
    // 事实归属完成;local profile 维持本地信任域标记;退役机器字样不得回流。
    expect(routeSource).toContain('presentationContextForIdentity(productionIdentity)');
    expect(routeSource).toContain('presentationContext,');
    expect(chatSituationSource).toContain("return { grantedApplications: ['local-demo'] };");
    for (const source of [routeSource, streamSource, chatSituationSource]) {
      expect(source).not.toContain('defaultPolicyScope');
      expect(source).not.toContain('scopeCoverage');
      expect(source).not.toContain('grantedPolicyScopes');
    }
    for (const source of [routeSource, streamSource]) {
      expect(source).not.toMatch(/completePresentationRequest\(intent,[\s\S]{0,300}policyScope/);
    }

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
    expect(streamSource).toMatch(
      /getPresentationBroker\(\)[\s\S]*?\.present\(request, args\.presentationContext\)/,
    );
    expect(streamSource).toContain('presentationJobs.push(job)');
    expect(streamSource).toMatch(
      /send\(\{[\s\S]*?type: 'final'[\s\S]*?await Promise\.allSettled\(presentationJobs\)/,
    );
    expect(streamSource).toMatch(
      /await appendNavigationCompletion\([\s\S]*?send\(\{ type: 'presentation'/,
    );
    expect(streamSource).toContain('chatMarkdown: true');
  });
});
