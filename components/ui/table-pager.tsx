"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

export const PAGE_SIZES = [5, 10, 25, 50, 100] as const;

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

interface TablePagerProps {
  total: number;
  noun: [singular: string, plural: string];
  page: number; // 1-based
  pageSize: number;
  onPageSize: (size: number) => void;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Keyboard hints shown on the buttons, when the page binds them. */
  previousHint?: ReactNode;
  nextHint?: ReactNode;
}

/** The footer every paged table shares: count, "Page X of Y", rows per page, Previous/Next. */
export function TablePager({ total, noun, page, pageSize, onPageSize, canPrevious, canNext, onPrevious, onNext, previousHint, nextHint }: TablePagerProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <p>{formatNumber(total)} {total === 1 ? noun[0] : noun[1]} · Page {formatNumber(page)} of {formatNumber(pageCount(total, pageSize))}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs">
          Rows per page
          <select aria-label="Rows per page" className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <Button variant="outline" size="sm" disabled={!canPrevious} onClick={onPrevious}><ChevronLeft aria-hidden="true" />Previous{previousHint ? <> {previousHint}</> : null}</Button>
        <Button variant="outline" size="sm" disabled={!canNext} onClick={onNext}>Next{nextHint ? <> {nextHint}</> : null}<ChevronRight aria-hidden="true" /></Button>
      </div>
    </div>
  );
}

/** Client-side paging over rows already in memory. Resetting to page 1 on a new page size keeps the view valid. */
export function useClientPaging<T>(rows: readonly T[], defaultPageSize: number) {
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [requestedPage, setPage] = useState(1);
  const pages = pageCount(rows.length, pageSize);
  // Rows can shrink under a filter or a refetch; never show a page past the end.
  const page = Math.min(requestedPage, pages);
  const visible = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);
  return {
    visible,
    pagerProps: {
      total: rows.length,
      page,
      pageSize,
      onPageSize: (size: number) => { setPageSize(size); setPage(1); },
      canPrevious: page > 1,
      canNext: page < pages,
      onPrevious: () => setPage(Math.max(1, page - 1)),
      onNext: () => setPage(Math.min(pages, page + 1)),
    },
    resetPage: () => setPage(1),
  };
}
