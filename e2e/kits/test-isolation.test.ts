import { expect, test } from '@playwright/test';
import { assertIsolatedTemporal, assertTestDatabase } from './test-isolation';

test('fixture database must be an explicitly isolated test database', () => {
  expect(() => assertTestDatabase('postgres://test@localhost:5433/ui4a_test')).not.toThrow();
  for (const name of ['ui4a', 'production', 'ui4a_test_extra']) {
    expect(() => assertTestDatabase(`postgres://test@localhost:5433/${name}`)).toThrow('isolated');
  }
});

test('fixture workers refuse the default development Temporal server', () => {
  for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '[::1]']) {
    expect(() => assertIsolatedTemporal(host)).toThrow('isolated');
    expect(() => assertIsolatedTemporal(`${host}:7233`)).toThrow('isolated');
  }
  expect(() => assertIsolatedTemporal('localhost:7235')).not.toThrow();
});
