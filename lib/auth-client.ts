/**
 * Browser-side token storage + an authed `fetch` wrapper. Never import this
 * from server code — it touches `window`/`localStorage` and is guarded for
 * SSR only so it doesn't crash on import, not so it's safe to use there.
 */

const STORAGE_KEY = 'resumix.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Fired whenever `authedFetch` receives a 401, after clearing the stored
 * token. `AuthGate` listens for this to fall back to the login screen
 * without a full page reload.
 */
export const AUTH_EXPIRED_EVENT = 'resumix:auth-expired';

function notifyAuthExpired(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

/**
 * `fetch` wrapper that attaches the stored token as `x-resumix-token`. On a
 * 401 response, clears the stored token and dispatches `AUTH_EXPIRED_EVENT`
 * so the UI can drop back to the login screen.
 */
export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set('x-resumix-token', token);
  }

  const response = await fetch(input, { ...init, headers });

  if (response.status === 401) {
    clearToken();
    notifyAuthExpired();
  }

  return response;
}
