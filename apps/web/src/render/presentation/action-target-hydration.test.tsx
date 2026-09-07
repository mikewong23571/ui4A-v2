// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SirenEntity } from '@ui4a/engine';
import { ActionSubmitProvider, type ActionSubmit } from '@/components/actions/action-submit';
import { DetailWord } from '../words/detail';
import {
  hydratePresentationSurface,
  planGenericPresentationSurface,
  type GenericPresentationPlan,
} from './generic';

const subject = 'opaque:review';
const declaration: SirenEntity = {
  class: ['unknown-work'],
  properties: {
    rel: subject,
    identity: 'UX0907 体验样本：整理审查发现并验证材料与状态闭环',
    presentation: { fields: [{ path: 'properties.identity', title: '目标', role: 'identity' }] },
  },
  actions: [
    {
      name: 'archive',
      title: '归档',
      method: 'POST',
      href: '/api/exec',
      'requires-confirmation': 'high',
      fields: {
        type: 'object',
        properties: {},
        description: '归档后，这条工作线将不再提供恢复或其他操作。已关联的对象保留。',
      },
    },
  ],
  links: [],
};

afterEach(cleanup);
function actionSlice(plan: GenericPresentationPlan): SirenEntity {
  expect(plan.bundle.issues).toEqual([]);
  const update = plan.bundle.messages.find((message) => 'updateDataModel' in message)!;
  if (!('updateDataModel' in update)) throw new Error('Missing hydration');
  const values = (
    update.updateDataModel.value as { values: Record<string, Record<string, unknown>> }
  ).values;
  const slice = Object.values(values)
    .map((value) => value.actions)
    .find((value) => value !== undefined);
  expect(slice).toBeTruthy();
  return slice as SirenEntity;
}

it('carries the authorized declared target from generic action binding into the real confirmation renderer', () => {
  const plan = planGenericPresentationSurface(subject, declaration, 'v1', 'read');
  const submit = vi.fn<ActionSubmit>();
  render(
    <ActionSubmitProvider submit={submit}>
      <DetailWord entity={actionSlice(plan)} mode="actions" />
    </ActionSubmitProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '归档' }));
  expect(screen.getByText(`操作对象：${declaration.properties.identity as string}`)).toBeTruthy();
  expect(screen.queryByText(`操作对象：${subject}`)).toBeNull();
  expect(screen.getByText(declaration.actions[0]!.fields.description as string)).toBeTruthy();
  expect(submit).not.toHaveBeenCalled();
  expect(JSON.stringify(plan.surface)).not.toContain(declaration.properties.identity);
  expect(JSON.stringify(plan.bundle.messages[2])).not.toContain(declaration.properties.identity);
});

it('rehydrates an existing binding against the latest identity without retaining the earlier title', () => {
  const plan = planGenericPresentationSurface(subject, declaration, 'v1', 'read');
  const current = {
    ...declaration,
    properties: { ...declaration.properties, identity: '重新核对当前审查结果' },
  };
  const refreshed = hydratePresentationSurface(subject, plan.surface, current);
  expect(actionSlice(refreshed).properties.identity).toBe(current.properties.identity);
  expect(actionSlice(refreshed).properties).not.toHaveProperty('presentation');
  expect(JSON.stringify(refreshed.surface)).not.toContain(current.properties.identity);
});
