'use client';

import { useEffect, type RefObject } from 'react';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Focuses a list page's search box on `/` or cmd+k, the way every list-with-a-
 * filter in the app behaves. Shared by the resume grid and the applications
 * board so the two cannot drift apart.
 *
 * `/` is ignored while the user is already typing somewhere — otherwise the
 * shortcut would eat the character.
 */
export function useSearchShortcut(inputRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const isCmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isCmdK) {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inputRef]);
}
