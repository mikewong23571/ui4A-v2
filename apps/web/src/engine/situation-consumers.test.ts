import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('T29 situation consumer matrix', () => {
  it('keeps chat plane and entity scope defaults on the same assembler', () => {
    const chatRoute = source('apps/web/src/app/api/chat/route.ts');
    const entityRoute = source('apps/web/src/app/api/entity/route.ts');
    expect(chatRoute).toContain('assembleSituation');
    expect(entityRoute).toContain('assembleSituation');
    expect(chatRoute).not.toContain('metaPlaneFromClientRoute');
    expect(chatRoute).toContain('situation.site');
    expect(entityRoute).toContain('const policyScope = situation.scope');
  });

  it('keeps the old route-bearing clientView path absent after the GR2 switch', () => {
    const protocol = source('packages/shared/src/presentation/chat-view.ts');
    expect(protocol).toContain('presence: ClientViewPresence');
    expect(protocol).not.toMatch(
      /export interface ClientViewReport[\s\S]{0,240}(?:route: string;|subject\?: RenderSubject;)/,
    );
  });
});
