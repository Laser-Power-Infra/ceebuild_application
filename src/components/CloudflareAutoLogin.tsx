'use client';

import { useEffect } from 'react';
import { getProviders, signIn } from 'next-auth/react';

// Once per browser tab: if nobody is signed in but the request came through Cloudflare Access
// (staff already logged in with Google there), sign in silently so there is no second login.
// See src/lib/auth/cloudflareAccess.ts. Logging out sets the flag to "off" for that tab.
export const CF_AUTO_LOGIN_FLAG = 'ceebuild-cf-auto-login';

export default function CloudflareAutoLogin() {
  useEffect(() => {
    let flag: string | null = null;
    try {
      flag = sessionStorage.getItem(CF_AUTO_LOGIN_FLAG);
      if (flag) return;
      sessionStorage.setItem(CF_AUTO_LOGIN_FLAG, 'tried');
    } catch {
      return; // storage blocked: skip rather than risk a reload loop
    }

    (async () => {
      const me = await fetch('/api/session-user', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      if (!me || me.user) return;
      const providers = await getProviders().catch(() => null);
      if (!providers?.['cloudflare-access']) return;
      const res = await signIn('cloudflare-access', { redirect: false });
      if (!res?.ok || res.error) return; // not behind Cloudflare (LAN address): normal login page still works

      const { pathname, search } = window.location;
      if (pathname === '/login' || pathname === '/signup') {
        const next = new URLSearchParams(search).get('next') || '/';
        window.location.href = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
      } else {
        window.location.reload();
      }
    })();
  }, []);

  return null;
}
