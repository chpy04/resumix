'use client';

import { useEffect, useState, type ReactNode } from 'react';
import LoginForm from '@/components/LoginForm';
import { getSession } from '@/lib/api-client';
import { AUTH_EXPIRED_EVENT } from '@/lib/auth-client';

type Status = 'checking' | 'authenticated' | 'unauthenticated';

/**
 * Gates its children behind the login screen.
 *
 * It asks the server who the caller is (`GET /api/session`) rather than
 * looking for a token in `localStorage`. That matters now that there is
 * more than one way to be logged in: in `dev` auth mode there is no token
 * at all — the server answers with the seeded user — and a stale token from
 * a previous auth mode would otherwise look like a valid session until the
 * first real request failed.
 *
 * A failed session check is the signal to show the password form. If a
 * session later expires mid-use, `authedFetch` dispatches
 * `AUTH_EXPIRED_EVENT` and we drop back here without a full page reload.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;

    async function check(): Promise<void> {
      try {
        await getSession();
        if (!cancelled) setStatus('authenticated');
      } catch {
        if (!cancelled) setStatus('unauthenticated');
      }
    }

    void check();

    function handleExpired(): void {
      setStatus('unauthenticated');
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    };
  }, []);

  // Render nothing until the session has been checked, so an
  // already-authenticated user never sees a flash of the login screen.
  if (status === 'checking') return null;

  if (status === 'unauthenticated') {
    // Re-ask the server after a successful login rather than assuming: the
    // freshly-minted token still has to resolve to a real user.
    return (
      <LoginForm
        onSuccess={() => {
          void getSession().then(
            () => setStatus('authenticated'),
            () => setStatus('unauthenticated'),
          );
        }}
      />
    );
  }

  return <>{children}</>;
}
