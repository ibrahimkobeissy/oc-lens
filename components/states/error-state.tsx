interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

/** A visible, honest failure state — never a silently blank panel where a chart/table should be. */
export function ErrorState({ title = "Something went wrong", message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          Retry
        </button>
      )}
    </div>
  );
}
