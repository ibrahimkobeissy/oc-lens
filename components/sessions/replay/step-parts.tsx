import { registerReplayPartRenderer } from "./part-registry";

/**
 * `step-start`/`step-finish` are verified, first-class part types (not
 * unrecognised shapes) — they're structural turn boundary markers, not
 * user-facing content. `step-start` carries no data at all; `step-finish`'s
 * cost/tokens/reason are already surfaced by `TurnMetrics` and the turn-level
 * token totals. Rendering them inline would just repeat that data as a bare
 * part card, so both render nothing rather than falling through to the
 * "Unsupported replay part" placeholder meant for genuinely unknown shapes.
 */
function StepPart(): null {
  return null;
}

registerReplayPartRenderer("step-start", StepPart);
registerReplayPartRenderer("step-finish", StepPart);
