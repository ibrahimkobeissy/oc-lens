"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CHORD_TIMEOUT_MS = 800;

const GO_TO_ROUTE: Readonly<Record<string, string>> = {
  o: "/",
  a: "/activity",
  s: "/sessions",
  p: "/projects",
  t: "/tools",
  c: "/costs",
};

export const LIST_NAVIGATION_EVENTS = {
  previous: "oc-lens:list-previous",
  next: "oc-lens:list-next",
} as const;

interface GlobalKeyboardNavOptions {
  onShowShortcuts: () => void;
}

interface ListKeyboardNavigationOptions {
  onPrevious?: () => void;
  onNext?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.matches("input, textarea, select, [contenteditable]:not([contenteditable='false'])") ||
    target.closest("[contenteditable]:not([contenteditable='false'])") !== null
  );
}

function isDialogOpen(): boolean {
  return (
    document.querySelector(
      "dialog[open], [role='dialog'][data-state='open'], [role='alertdialog'][data-state='open'], [role='dialog'][aria-modal='true'], [role='alertdialog'][aria-modal='true']",
    ) !== null
  );
}

/**
 * Installs the single application-level keyboard listener.
 *
 * List pages can subscribe to `[` and `]` with `useListKeyboardNavigation`;
 * the global listener remains centralized in `KeyboardNavProvider`.
 */
export function useGlobalKeyboardNav({ onShowShortcuts }: GlobalKeyboardNavOptions): boolean {
  const router = useRouter();
  const [isGoMode, setIsGoMode] = useState(false);
  const goModeRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearGoMode = useCallback(() => {
    goModeRef.current = false;
    setIsGoMode(false);
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target) ||
        isDialogOpen()
      ) {
        return;
      }

      const key = event.key.toLowerCase();

      if (goModeRef.current) {
        clearGoMode();
        if (key === "escape") return;

        const destination = GO_TO_ROUTE[key];
        if (destination !== undefined) {
          event.preventDefault();
          router.push(destination);
        }
        return;
      }

      if (key === "g") {
        event.preventDefault();
        goModeRef.current = true;
        setIsGoMode(true);
        timeoutRef.current = setTimeout(clearGoMode, CHORD_TIMEOUT_MS);
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        onShowShortcuts();
        return;
      }

      if (event.key === "[" || event.key === "]") {
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent(
            event.key === "[" ? LIST_NAVIGATION_EVENTS.previous : LIST_NAVIGATION_EVENTS.next,
          ),
        );
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearGoMode();
    };
  }, [clearGoMode, onShowShortcuts, router]);

  return isGoMode;
}

/** Registers the callbacks that `[` and `]` invoke for the active list view. */
export function useListKeyboardNavigation({
  onPrevious,
  onNext,
}: ListKeyboardNavigationOptions): void {
  useEffect(() => {
    function handlePrevious() {
      onPrevious?.();
    }

    function handleNext() {
      onNext?.();
    }

    window.addEventListener(LIST_NAVIGATION_EVENTS.previous, handlePrevious);
    window.addEventListener(LIST_NAVIGATION_EVENTS.next, handleNext);
    return () => {
      window.removeEventListener(LIST_NAVIGATION_EVENTS.previous, handlePrevious);
      window.removeEventListener(LIST_NAVIGATION_EVENTS.next, handleNext);
    };
  }, [onNext, onPrevious]);
}
