/**
 * Repeat thresholds offered in the UI.
 *
 * Starts at 3, not 2, and that is a product decision rather than an oversight:
 * a call that ran exactly twice is nearly always ordinary work — re-reading a
 * file after a compaction, or checking something once more. On the maintainer's
 * real database every single pair had 52–77 unrelated tool calls between its two
 * runs, which is not a loop by any reading.
 *
 * Both the Loops page and the in-session panel read this list, so the two can
 * never drift apart and leave a row on one page that shows nothing on the other.
 * The API still accepts `minRepeats=2` for diagnostics and threshold sweeps.
 */
export const MIN_REPEAT_CHOICES = [3, 4, 5, 6] as const;

/** The threshold both surfaces start on — matches the detector's own default. */
export const DEFAULT_UI_MIN_REPEATS = 3;
