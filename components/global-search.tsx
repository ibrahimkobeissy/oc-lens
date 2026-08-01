"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, FileText, FolderOpen } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { ROUTES } from "@/lib/routes";
import type { SearchData } from "@/app/api/search/route";

const SEARCH_DELAY_MS = 200;
const RECENT_STORAGE_KEY = "oc-lens:global-search:recent";
const RECENT_LIMIT = 5;
const EMPTY_RESULTS: SearchData = {
  sessions: [],
  projects: [],
  totals: { sessions: 0, projects: 0 },
};

type SearchState =
  | { status: "idle" | "loading"; data: SearchData }
  | { status: "success"; data: SearchData }
  | { status: "error"; data: SearchData; message: string };

interface RecentSelection {
  kind: "page" | "session" | "project";
  href: string;
  label: string;
  detail: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSearchData(value: unknown): value is SearchData {
  if (!isRecord(value) || !Array.isArray(value.sessions) || !Array.isArray(value.projects)) return false;
  if (!isRecord(value.totals)) return false;
  return typeof value.totals.sessions === "number" && typeof value.totals.projects === "number";
}

function readErrorMessage(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  return typeof value.error.message === "string" ? value.error.message : null;
}

function readRecentSelections(): RecentSelection[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentSelection => {
      if (!isRecord(item)) return false;
      return (
        (item.kind === "page" || item.kind === "session" || item.kind === "project") &&
        typeof item.href === "string" &&
        item.href.startsWith("/") &&
        typeof item.label === "string" &&
        typeof item.detail === "string"
      );
    }).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function saveRecentSelection(selection: RecentSelection): RecentSelection[] {
  const next = [selection, ...readRecentSelections().filter((item) => item.href !== selection.href)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Search remains usable when storage is disabled or full.
  }
  return next;
}

function RecentIcon({ kind }: { kind: RecentSelection["kind"] }) {
  if (kind === "session") return <FileText className="size-4" />;
  if (kind === "project") return <FolderOpen className="size-4" />;
  return <Clock3 className="size-4" />;
}

function ShowingCount({ shown, total }: { shown: number; total: number }) {
  return <span className="ml-2 font-normal normal-case">showing {shown} of {total}</span>;
}

interface SearchShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  repeat: boolean;
}

export function shouldHandleSearchShortcut(event: SearchShortcutEvent, searchOpen: boolean, dialogOpen: boolean): boolean {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    (searchOpen || !dialogOpen) &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === "k"
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<RecentSelection[]>([]);
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle", data: EMPTY_RESULTS });

  const changeOpen = useCallback((next: boolean) => {
    openRef.current = next;
    setOpen(next);
    if (next) {
      setRecent(readRecentSelections());
    } else {
      setQuery("");
      setSearchState({ status: "idle", data: EMPTY_RESULTS });
    }
  }, []);

  useEffect(() => {
    function handleKeyboardShortcut(event: KeyboardEvent) {
      const dialogOpen = document.querySelector(
        "dialog[open], [role='dialog'][data-state='open'], [role='alertdialog'][data-state='open'], [role='dialog'][aria-modal='true'], [role='alertdialog'][aria-modal='true']",
      ) !== null;
      if (shouldHandleSearchShortcut(event, openRef.current, dialogOpen)) {
        event.preventDefault();
        changeOpen(!openRef.current);
      }
    }

    function handleOpenRequest() {
      changeOpen(true);
    }

    window.addEventListener("keydown", handleKeyboardShortcut);
    window.addEventListener("open-search", handleOpenRequest);
    window.addEventListener("oc-lens:open-search", handleOpenRequest);
    return () => {
      window.removeEventListener("keydown", handleKeyboardShortcut);
      window.removeEventListener("open-search", handleOpenRequest);
      window.removeEventListener("oc-lens:open-search", handleOpenRequest);
    };
  }, [changeOpen]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!open || normalizedQuery.length === 0) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(normalizedQuery)}`, {
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(readErrorMessage(payload) ?? "Search is unavailable.");
        }
        if (!isRecord(payload) || !isSearchData(payload.data)) {
          throw new Error("Search returned an invalid response.");
        }
        setSearchState({ status: "success", data: payload.data });
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchState({
          status: "error",
          data: EMPTY_RESULTS,
          message: error instanceof Error ? error.message : "Search is unavailable.",
        });
      }
    }, SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query]);

  const navigate = useCallback((selection: RecentSelection) => {
    setRecent(saveRecentSelection(selection));
    router.push(selection.href);
    changeOpen(false);
  }, [changeOpen, router]);

  function changeQuery(value: string) {
    setQuery(value);
    setSearchState({ status: value.trim() ? "loading" : "idle", data: EMPTY_RESULTS });
  }

  const hasQuery = query.trim().length > 0;
  const { sessions, projects, totals } = searchState.data;

  return (
    <CommandDialog
      open={open}
      onOpenChange={changeOpen}
      title="Search oc-lens"
      description="Search pages, sessions, and projects"
    >
      <CommandInput
        value={query}
        onValueChange={changeQuery}
        placeholder="Search pages, sessions, projects…"
      />
      <CommandList>
        <CommandEmpty>
          {searchState.status === "loading"
            ? "Searching…"
            : searchState.status === "error"
              ? searchState.message
              : "No results found."}
        </CommandEmpty>

        {!hasQuery && recent.length > 0 && (
          <CommandGroup heading="Recent">
            {recent.map((item) => (
              <CommandItem
                key={`${item.kind}-${item.href}`}
                value={`recent ${item.label} ${item.detail}`}
                onSelect={() => navigate(item)}
              >
                <RecentIcon kind={item.kind} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{item.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.detail}</div>
                </div>
                <CommandShortcut>{item.kind}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!hasQuery && recent.length > 0 && <CommandSeparator />}

        <CommandGroup heading="Pages">
          {ROUTES.map((route) => {
            const Icon = route.icon;
            return (
              <CommandItem
                key={route.href}
                value={`page ${route.label} ${route.href}`}
                disabled={!route.enabled}
                onSelect={() => navigate({
                  kind: "page",
                  href: route.href,
                  label: route.label,
                  detail: route.href,
                })}
              >
                <Icon className="size-4" />
                <span className="flex-1 truncate">{route.label}</span>
                <CommandShortcut>{route.enabled ? "page" : "not built"}</CommandShortcut>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {hasQuery && sessions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={<span>Sessions <ShowingCount shown={sessions.length} total={totals.sessions} /></span>}>
              {sessions.map((session) => (
                <CommandItem
                  key={session.id}
                  value={`session ${session.title} ${session.slug} ${session.projectDisplayName}`}
                  onSelect={() => navigate({
                    kind: "session",
                    href: `/sessions/${encodeURIComponent(session.id)}`,
                    label: session.title,
                    detail: `${session.slug} · ${session.projectDisplayName}`,
                  })}
                >
                  <FileText className="size-4" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{session.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {session.slug} · {session.projectDisplayName}
                    </div>
                  </div>
                  <CommandShortcut>session</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {hasQuery && projects.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={<span>Projects <ShowingCount shown={projects.length} total={totals.projects} /></span>}>
              {projects.map((project) => (
                <CommandItem
                  key={project.id}
                  value={`project ${project.displayName} ${project.id} ${project.worktree}`}
                  onSelect={() => navigate({
                    kind: "project",
                    href: `/projects/${encodeURIComponent(project.id)}`,
                    label: project.displayName,
                    detail: `${project.sessionCount} sessions`,
                  })}
                >
                  <FolderOpen className="size-4" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{project.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">{project.worktree}</div>
                  </div>
                  <CommandShortcut>{project.sessionCount} sessions</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>

      <div className="flex items-center gap-4 border-t border-border px-3 py-2 font-mono text-[10px] text-muted-foreground">
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>esc close</span>
        <span className="ml-auto">⌘K toggle</span>
      </div>
    </CommandDialog>
  );
}
