/** Next.js calls this once and awaits it before the server accepts requests. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runWebProductionDeploymentPreflight } =
      await import('./production-deployment-preflight');
    runWebProductionDeploymentPreflight();
  }
}
