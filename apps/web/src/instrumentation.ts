/** Next.js calls this once and awaits it before the server accepts requests. */
export async function register(): Promise<void> {
  // The standalone server may omit NEXT_RUNTIME; only an explicit Edge runtime lacks Node APIs.
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const { runWebProductionDeploymentPreflight } = await import('./production-deployment-preflight');
  runWebProductionDeploymentPreflight();
}
