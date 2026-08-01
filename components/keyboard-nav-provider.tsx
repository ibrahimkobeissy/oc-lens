"use client";

import { useCallback, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGlobalKeyboardNav } from "@/hooks/use-global-keyboard-nav";

const SHORTCUT_GROUPS = [
  {
    label: "Go to",
    shortcuts: [
      { keys: ["g", "o"], description: "Overview" },
      { keys: ["g", "a"], description: "Activity" },
      { keys: ["g", "s"], description: "Sessions" },
      { keys: ["g", "p"], description: "Projects" },
      { keys: ["g", "t"], description: "Tools" },
      { keys: ["g", "c"], description: "Costs" },
    ],
  },
  {
    label: "Navigation",
    shortcuts: [
      { keys: ["["], description: "Previous page or item" },
      { keys: ["]"], description: "Next page or item" },
      { keys: ["?"], description: "Show keyboard shortcuts" },
    ],
  },
] as const;

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-7 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground shadow-xs">
      {children}
    </kbd>
  );
}

export function KeyboardNavProvider() {
  const [isShortcutSheetOpen, setIsShortcutSheetOpen] = useState(false);
  const showShortcuts = useCallback(() => setIsShortcutSheetOpen(true), []);
  const isGoMode = useGlobalKeyboardNav({ onShowShortcuts: showShortcuts });

  return (
    <>
      {isGoMode && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed right-4 bottom-20 z-40 rounded-md border border-primary/60 bg-background px-3 py-1.5 font-mono text-sm text-primary shadow-lg md:bottom-4"
        >
          g —
          <span className="sr-only">Go to shortcut started</span>
        </div>
      )}

      <Dialog open={isShortcutSheetOpen} onOpenChange={setIsShortcutSheetOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Navigate oc-lens without leaving the keyboard. Shortcuts pause while you type or a dialog is open.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.label} aria-labelledby={`shortcut-${group.label.toLowerCase().replaceAll(" ", "-")}`}>
                <h2
                  id={`shortcut-${group.label.toLowerCase().replaceAll(" ", "-")}`}
                  className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {group.label}
                </h2>
                <dl className="divide-y divide-border rounded-md border border-border">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.description}
                      className="flex items-center justify-between gap-4 px-3 py-2.5"
                    >
                      <dt className="text-sm text-foreground">{shortcut.description}</dt>
                      <dd className="flex shrink-0 items-center gap-1" aria-label={shortcut.keys.join(" then ")}>
                        {shortcut.keys.map((key, index) => (
                          <span key={`${shortcut.description}-${key}`} className="contents">
                            {index > 0 && <span className="text-xs text-muted-foreground">then</span>}
                            <Key>{key}</Key>
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
