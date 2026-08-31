/** Refuse destructive fixture setup against a development or production database. */
export function assertTestDatabase(databaseUrl: string): void {
  const database = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!database.endsWith('_test')) {
    throw new Error('E2E requires an isolated DATABASE_URL whose database name ends with _test');
  }
}

/** Default local Temporal is shared with dev:all; fixture workers must never poll it. */
export function assertIsolatedTemporal(address: string): void {
  const url = new URL(`http://${address}`);
  if (
    ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(url.hostname) &&
    (url.port === '' || url.port === '7233')
  ) {
    throw new Error(
      'E2E worker tests require an isolated TEMPORAL_ADDRESS, not dev:all localhost:7233',
    );
  }
}
