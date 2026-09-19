'use client';

import { useEffect, useState, type ReactNode } from 'react';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';
import LoginForm from '@/components/LoginForm';
import { AUTH_EXPIRED_EVENT, getToken } from '@/lib/auth-client';

type Status = 'checking' | 'authenticated' | 'unauthenticated';

/**
 * Gates its children behind the password screen. Only checks that *a* token
 * is stored, not that it is still valid — that would require shipping
 * `AUTH_SECRET` to the browser, which defeats the point. Real enforcement
 * happens server-side in `middleware.ts`; if a stored token is expired or
 * tampered with, the first `authedFetch` call gets a 401, which clears the
 * token and dispatches `AUTH_EXPIRED_EVENT`, dropping back to this screen.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    setStatus(getToken() ? 'authenticated' : 'unauthenticated');

    function handleExpired(): void {
      setStatus('unauthenticated');
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, []);

  // Render nothing until the stored token has been checked, so an
  // already-authenticated user never sees a flash of the login screen.
  if (status === 'checking') return null;

  if (status === 'unauthenticated') {
    return <LoginForm onSuccess={() => setStatus('authenticated')} />;
  }

  // The feedback widget is mounted here rather than in the root layout so it
  // only ever appears behind the password gate — its API call needs a token,
  // and offering it on the login screen would be a button that can only fail.
  return (
    <>
      {children}
      <FeedbackWidget />
    </>
  );
}
