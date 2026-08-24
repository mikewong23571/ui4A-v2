export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    status: 'live',
    component: 'ui4a-web',
    release: {
      version: process.env.UI4A_VERSION ?? 'v0.1.0-experimental.1-dev',
      gitSha: process.env.UI4A_GIT_SHA ?? 'unknown',
      buildDate: process.env.UI4A_BUILD_DATE ?? 'unknown',
      channel: 'experimental',
    },
  });
}
