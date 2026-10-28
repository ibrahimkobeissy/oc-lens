/** Shapes of the slow-start signal, kept free of server imports so client components can use them. See lib/queries/slow-starts.ts. */

export const SLOW_START_MIN_SECONDS = 30;
export const SLOW_START_FACTOR = 3;

export interface SlowStep {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  timeCreated: number;
  model: string; // providerID/modelID
  waitSeconds: number; // time.streamed - time.created: how long the step waited for its first token
  baselineSeconds: number; // this model's median wait over all recorded steps
}

export interface SlowStartDay {
  date: string;
  steps: number; // steps with a recorded first-token time
  medianSeconds: number;
  p90Seconds: number;
  slowSteps: number;
}

export interface SlowStartReport {
  /** False when no step records a first-token time (opencode 1.x never did), so "no slow starts" would be a false all-clear. */
  measurable: boolean;
  byDay: SlowStartDay[]; // newest first
  slowSteps: SlowStep[]; // newest first
}
