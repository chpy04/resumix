/**
 * Copying one line of text, and saying honestly whether it worked.
 *
 * The Clipboard API exists only in a secure context (https, or localhost),
 * and even there `writeText` can refuse: a browser may want the call to come
 * straight from a click, and an approval that compiles two documents first is
 * seconds after the click. So the caller always needs a fallback, and this
 * says which one: `unavailable` means there is no API to try again with,
 * `failed` means there is and a fresh click may succeed (D-044).
 *
 * `env` is the global object by default, and a fake in the tests.
 */

export type CopyResult = 'copied' | 'unavailable' | 'failed';

export interface ClipboardEnv {
  isSecureContext?: boolean;
  navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } };
}

/** Whether `copyText` has an API to call at all. */
export function canCopy(env: ClipboardEnv = globalThis): boolean {
  return env.isSecureContext === true && typeof env.navigator?.clipboard?.writeText === 'function';
}

export async function copyText(text: string, env: ClipboardEnv = globalThis): Promise<CopyResult> {
  if (!canCopy(env)) return 'unavailable';
  try {
    await env.navigator!.clipboard!.writeText!(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
