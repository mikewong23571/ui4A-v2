import { cookies } from 'next/headers';

import { BROWSER_SESSION_COOKIE_NAME } from '@/auth/browser-session';
import { SiteNav } from '@/components/site-nav';

/** Project request-time browser session presence into the otherwise static navigation shell. */
export async function SessionAwareSiteNav() {
  const cookieStore = await cookies();
  return <SiteNav sessionControls={cookieStore.has(BROWSER_SESSION_COOKIE_NAME)} />;
}
