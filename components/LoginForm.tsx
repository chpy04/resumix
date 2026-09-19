'use client';

import { useState, type FormEvent } from 'react';
import { setToken } from '@/lib/auth-client';

interface LoginFormProps {
  /** Called after a token is successfully minted and stored. */
  onSuccess?: () => void;
}

/**
 * The password entry form. Used by the `/login` route and inline by
 * `components/AuthGate.tsx`, so there is one implementation, not a
 * redirect-and-back-again.
 *
 * Lives outside `app/login/page.tsx` because a `page.tsx` module may only
 * export the handful of names Next's app router recognizes (`default`,
 * `metadata`, `generateStaticParams`, etc.) — any other named export,
 * including this component, fails Next 15's generated type check at build
 * time.
 */
export default function LoginForm({ onSuccess }: LoginFormProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || password.length === 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setError('Wrong password.');
        setPassword('');
        return;
      }

      const data = (await response.json()) as { token: string };
      setToken(data.token);
      onSuccess?.();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-8 shadow-lg"
      >
        <h1 className="text-lg font-semibold text-[var(--color-ink)]">Resumix</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-dim)]">Enter the password to continue.</p>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (error) setError(null);
          }}
          placeholder="Password"
          disabled={submitting}
          className="mt-6 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
        />

        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}

        <button
          type="submit"
          disabled={submitting || password.length === 0}
          className="mt-4 w-full rounded-md bg-[var(--color-accent)] px-3 py-2 font-medium text-[var(--color-canvas)] transition-opacity disabled:opacity-50"
        >
          {submitting ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </main>
  );
}
