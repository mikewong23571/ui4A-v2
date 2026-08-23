import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const chatRoute = source('../../../apps/web/src/app/api/chat/route.ts');
const chatPanel = source('../../../apps/web/src/components/chat-panel.tsx');
const conversation = source('../../../apps/web/src/chat/conversation.ts');
const llmDriver = source('./llm-driver.ts');
const agentLoop = source('./loop.ts');

describe('T21 AI-first dual-focus source governance', () => {
  it('keeps client view and last navigation as separate projection fields', () => {
    expect(conversation).toContain('clientView: ClientViewFact | null');
    expect(conversation).toContain('lastNavigation: LastNavigationFact | null');
    expect(conversation).not.toMatch(/currentRel\s*:\s*(?:clientView|lastNavigation)/);
    expect(conversation).not.toMatch(
      /(?:clientView|lastNavigation)\s*=\s*(?:lastNavigation|clientView)/,
    );
  });

  it('contains no phrase-driven display or navigation branch in product decision paths', () => {
    const branchOnDisplayPhrase =
      /(?:includes|startsWith|endsWith|match|test)\s*\(\s*(?:['"`][^'"`]*(?:看看|列表|详情)|\/[^/\n]*(?:看看|列表|详情))/;
    for (const [name, content] of [
      ['chat route', chatRoute],
      ['chat client', chatPanel],
      ['LLM driver', llmDriver],
      ['Agent loop', agentLoop],
    ] as const) {
      expect(content, name).not.toMatch(branchOnDisplayPhrase);
    }
  });

  it('does not let client route/view enter authorization, tool projection or start-rel discovery', () => {
    for (const path of ['./authorization.ts', './tools.ts', './http.ts']) {
      expect(source(path), path).not.toMatch(/ClientView|clientView|LastNavigation|lastNavigation/);
    }
    expect(chatRoute).not.toMatch(/resolveStartRel\([\s\S]{0,300}(?:clientView|lastNavigation)/);
  });

  it('keeps the production runtime free of the legacy rule driver', () => {
    for (const [name, content] of [
      ['chat route', chatRoute],
      ['LLM driver', llmDriver],
      ['Agent loop', agentLoop],
    ] as const) {
      expect(content, name).not.toMatch(/createRuleDriver|from ['"].*rule-driver['"]/);
    }
  });

  it('uses provider protocol constraints and never parses rejected model text into an operation', () => {
    expect(llmDriver).toContain("toolChoice: 'required'");
    expect(llmDriver).toContain('const repaired = await llmDecisionAttempt');
    expect(llmDriver).not.toMatch(/JSON\.parse\(\s*text|mapToolCall\([^\n]*text/);
    expect(llmDriver).not.toMatch(/(?:includes|match|test)\([^\n]*协议修复/);
  });
});
