import { expect, it } from 'vitest';
import { entityContractFingerprint } from './entity-contract';

function collection() {
  return {
    class: ['collection'],
    properties: { rel: 'records' },
    actions: [],
    links: [],
    entities: [
      {
        class: ['record'],
        properties: {
          rel: 'record:a',
          title: 'Title',
          status: 'open',
          presentation: { fields: [{ path: 'properties.status', role: 'status' }] },
        },
        actions: [{ name: 'close' }],
        links: [],
      },
    ],
  };
}

it('member cognitive declarations and action contracts invalidate existing plans', () => {
  const entity = collection();
  const initial = entityContractFingerprint(entity);
  entity.entities[0]!.properties.presentation.fields[0]!.path = 'properties.statusText';
  const newBinding = entityContractFingerprint(entity);
  expect(newBinding).not.toBe(initial);
  entity.entities[0]!.actions = [{ name: 'reopen' }];
  expect(entityContractFingerprint(entity)).not.toBe(newBinding);
});

it('current factual values remain hydration inputs, outside contract fingerprints', () => {
  const entity = collection();
  const initial = entityContractFingerprint(entity);
  entity.entities[0]!.properties.title = 'Revised title';
  entity.entities[0]!.properties.status = 'closed';
  expect(entityContractFingerprint(entity)).toBe(initial);
});

it('nested responsibility contracts are included recursively', () => {
  const entity = { ...collection(), entities: [collection()] };
  const initial = entityContractFingerprint(entity);
  entity.entities[0]!.entities[0]!.actions = [];
  expect(entityContractFingerprint(entity)).not.toBe(initial);
});

it('reference option labels hydrate while declared choices and schemas remain contract inputs', () => {
  const entity = collection();
  const option = { title: 'Old material title', params: { category: 'context', rel: 'record:a' } };
  const selected = {
    ...entity,
    actions: [
      {
        name: 'detach',
        fields: {
          type: 'object',
          'x-ui4a-reference-selection': { effect: 'unlink', options: [option] },
        },
      },
    ],
  };
  const initial = entityContractFingerprint(selected);
  option.title = 'New material title';
  expect(entityContractFingerprint(selected)).toBe(initial);
  option.params.rel = 'record:b';
  expect(entityContractFingerprint(selected)).not.toBe(initial);
});
