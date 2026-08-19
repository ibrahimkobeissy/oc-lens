import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { withFixture, withEmptyFixture } from "../../../test/fixtures";
import { FIXTURE_SCHEMA_SQL } from "../../../test/fixtures/schema";
import { LOOP_SCENARIOS, LOOP_TURN_USAGE, PROVIDER_MODELS } from "../../../test/fixtures/manifest";
import { detectLoops } from "../loops";
import { callSignature, canonicalise, isSignaturable } from "../../loops";
import type { LoopKind, PricingConfig } from "../../../types/oc";

/**
 * The detector judged against the fixture's planted ground truth
 * (`test/fixtures/manifest.ts` → LOOP_SCENARIOS). The two zero-incident
 * scenarios carry the most weight: they are what separates a detector from a
 * same-tool counter.
 */

const FLAT_RATE = {
  inputPerMTok: 1,
  outputPerMTok: 1,
  cacheReadPerMTok: 1,
  cacheWritePerMTok: 1,
  currency: "USD" as const,
};

const PRICING: PricingConfig = {
  version: 1,
  prices: Object.fromEntries(PROVIDER_MODELS.map((m) => [`${m.providerID}/${m.modelID}`, FLAT_RATE])),
  updatedAt: 1,
};

/** Every planted turn has one tool call and fixed usage, so one wasted call costs exactly this. */
const COST_PER_WASTED_CALL = (LOOP_TURN_USAGE.input + LOOP_TURN_USAGE.output) / 1_000_000;

const EXPECTED: Record<keyof typeof LOOP_SCENARIOS, { kind: LoopKind; calls: number } | null> = {
  errorRetry: { kind: "error-retry", calls: 4 },
  redundantRepeat: { kind: "redundant-repeat", calls: 5 },
  oscillation: { kind: "oscillation", calls: 4 },
  unsignaturable: null,
  interleavedRepeat: { kind: "redundant-repeat", calls: 3 },
  control: null,
};

describe("detectLoops against planted scenarios", () => {
  for (const [name, scenario] of Object.entries(LOOP_SCENARIOS)) {
    const expected = EXPECTED[name as keyof typeof LOOP_SCENARIOS];

    it(`${name}: finds exactly ${scenario.expectedIncidents} incident(s)`, () => {
      withFixture((db) => {
        const { data } = detectLoops(db, { sessionId: scenario.sessionId }, PRICING);
        expect(data.incidents).toHaveLength(scenario.expectedIncidents);

        if (expected === null) return;
        const incident = data.incidents[0];
        expect(incident?.kind).toBe(expected.kind);
        expect(incident?.tool).toBe(scenario.tool);
        expect(incident?.calls).toBe(expected.calls);
        expect(incident?.wastedCalls).toBe(expected.calls - 1);
        expect(incident?.sessionId).toBe(scenario.sessionId);
        expect(incident?.partIds).toHaveLength(expected.calls);
      });
    });

    if (expected !== null) {
      it(`${name}: prices the wasted calls exactly, without the first`, () => {
        withFixture((db) => {
          const { data } = detectLoops(db, { sessionId: scenario.sessionId }, PRICING);
          const incident = data.incidents[0];
          expect(incident?.repeatedTurnCost.priced).toBe(true);
          expect(incident?.repeatedTurnCost.amount).toBeCloseTo((expected.calls - 1) * COST_PER_WASTED_CALL, 10);
          expect(incident?.repeatedTurnTokens.input).toBe((expected.calls - 1) * LOOP_TURN_USAGE.input);
        });
      });
    }
  }

  it("reports incidents in chronological order within an incident", () => {
    withFixture((db) => {
      const { data } = detectLoops(db, { sessionId: LOOP_SCENARIOS.redundantRepeat.sessionId }, PRICING);
      const incident = data.incidents[0];
      expect(incident?.firstAt).toBeLessThan(incident?.lastAt ?? 0);
    });
  });

  it("catches repeats separated by unrelated calls, not just adjacent ones", () => {
    withFixture((db) => {
      const scenario = LOOP_SCENARIOS.interleavedRepeat;
      const { data } = detectLoops(db, { sessionId: scenario.sessionId }, PRICING);
      expect(data.incidents).toHaveLength(1);
      // 5 calls in the session, but only the 3 bash calls form the incident.
      expect(data.coverage.toolCalls).toBe(scenario.sessionCalls);
      expect(data.incidents[0]?.calls).toBe(3);
    });
  });
});

describe("coverage is reported, never assumed", () => {
  it("counts calls that recorded no input instead of treating them as equal", () => {
    withFixture((db) => {
      const scenario = LOOP_SCENARIOS.unsignaturable;
      const { data } = detectLoops(db, { sessionId: scenario.sessionId }, PRICING);
      expect(data.incidents).toHaveLength(0);
      expect(data.coverage.toolCalls).toBe(scenario.sessionCalls);
      expect(data.coverage.signaturable).toBe(0);
      expect(data.coverage.unsignaturable).toBe(scenario.sessionCalls);
      expect(data.coverage.unsignaturableTools).toContain("glob");
    });
  });

  it("does not list a tool as unsignaturable when at least one call carried input", () => {
    withFixture((db) => {
      const { data } = detectLoops(db, { sessionId: LOOP_SCENARIOS.control.sessionId }, PRICING);
      expect(data.coverage.signaturable).toBe(LOOP_SCENARIOS.control.sessionCalls);
      expect(data.coverage.unsignaturable).toBe(0);
      expect(data.coverage.unsignaturableTools).toEqual([]);
    });
  });
});

describe("honest degradation", () => {
  it("returns an empty, unpriced analysis on an empty database", () => {
    withEmptyFixture((db) => {
      const { data } = detectLoops(db, {}, PRICING);
      expect(data.incidents).toEqual([]);
      expect(data.totalWastedCalls).toBe(0);
      expect(data.totalRepeatedTurnCost).toEqual({ amount: 0, priced: false });
      expect(data.coverage.toolCalls).toBe(0);
    });
  });

  it("marks wasted cost unpriced when no price is configured, rather than reporting $0 of waste", () => {
    withFixture((db) => {
      const { data } = detectLoops(db, { sessionId: LOOP_SCENARIOS.errorRetry.sessionId });
      expect(data.incidents).toHaveLength(1);
      expect(data.incidents[0]?.wastedCalls).toBe(3);
      expect(data.incidents[0]?.repeatedTurnCost).toEqual({ amount: 0, priced: false });
      expect(data.totalRepeatedTurnCost).toEqual({ amount: 0, priced: false });
    });
  });

  it("honours a raised minRepeats threshold", () => {
    withFixture((db) => {
      // The 3-call bash repeat disappears at a threshold of 4; the 5-call read repeat survives.
      const interleaved = detectLoops(db, { sessionId: LOOP_SCENARIOS.interleavedRepeat.sessionId }, PRICING, {
        minRepeats: 4,
      });
      expect(interleaved.data.incidents).toHaveLength(0);

      const redundant = detectLoops(db, { sessionId: LOOP_SCENARIOS.redundantRepeat.sessionId }, PRICING, {
        minRepeats: 4,
      });
      expect(redundant.data.incidents).toHaveLength(1);
    });
  });
});

describe("signature rules", () => {
  it("is order-insensitive over input keys, so the same call cannot hash two ways", () => {
    expect(canonicalise({ a: 1, b: [2, { d: 4, c: 3 }] })).toBe(canonicalise({ b: [2, { c: 3, d: 4 }], a: 1 }));
    expect(callSignature("edit", { filePath: "/x", content: "y" })).toBe(
      callSignature("edit", { content: "y", filePath: "/x" }),
    );
  });

  it("refuses to sign an absent, empty, or non-object input", () => {
    expect(isSignaturable(undefined)).toBe(false);
    expect(isSignaturable({})).toBe(false);
    expect(isSignaturable([])).toBe(false);
    expect(callSignature("glob", {})).toBeNull();
    expect(callSignature("glob", undefined)).toBeNull();
  });

  it("never carries raw input — the signature is a hash and the tool name only", () => {
    const secret = "AKIA_NOT_A_REAL_KEY_000";
    const signature = callSignature("bash", { command: `export TOKEN=${secret}` });
    expect(signature).not.toBeNull();
    expect(signature).not.toContain(secret);
    expect(signature).not.toContain("export");
    expect(signature?.startsWith("bash:")).toBe(true);
  });

  it("separates different tools with identical inputs", () => {
    expect(callSignature("read", { filePath: "/x" })).not.toBe(callSignature("write", { filePath: "/x" }));
  });
});

describe("a re-read after the file changed is not a repeat", () => {
  function seed(db: DatabaseSync, calls: Array<{ tool: string; input: unknown; at: number; status?: string }>): void {
    db.exec(FIXTURE_SCHEMA_SQL);
    db.prepare(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('s1','global','s1','/','s1','1.17.7',0,999)",
    ).run();
    db.prepare(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m1','s1',0,0,?)",
    ).run(JSON.stringify({ role: "assistant", modelID: "m", providerID: "p", tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, completed: 1 } }));
    calls.forEach((call, index) => {
      db.prepare(
        "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,'m1','s1',?,?,?)",
      ).run(`p${index}`, call.at, call.at, JSON.stringify({
        type: "tool",
        tool: call.tool,
        callID: `c${index}`,
        state: { status: call.status ?? "completed", input: call.input, output: "ok", metadata: {}, title: call.tool, time: { start: call.at, end: call.at + 1 } },
      }));
    });
  }

  const FILE = "/repo/src/a.ts";

  it("does not flag read → edit → read of the same path", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seed(db, [
        { tool: "read", input: { filePath: FILE }, at: 10 },
        { tool: "edit", input: { filePath: FILE, content: "next" }, at: 20 },
        { tool: "read", input: { filePath: FILE }, at: 30 },
      ]);
      expect(detectLoops(db, {}, undefined, { minRepeats: 2 }).data.incidents).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("still flags two reads with no modification between them", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seed(db, [
        { tool: "read", input: { filePath: FILE }, at: 10 },
        { tool: "read", input: { filePath: FILE }, at: 30 },
      ]);
      const incidents = detectLoops(db, {}, undefined, { minRepeats: 2 }).data.incidents;
      expect(incidents).toHaveLength(1);
      expect(incidents[0]?.kind).toBe("redundant-repeat");
      expect(incidents[0]?.calls).toBe(2);
    } finally {
      db.close();
    }
  });

  it("does not let a failed edit excuse a repeat, since nothing changed", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seed(db, [
        { tool: "read", input: { filePath: FILE }, at: 10 },
        { tool: "edit", input: { filePath: FILE, content: "next" }, at: 20, status: "error" },
        { tool: "read", input: { filePath: FILE }, at: 30 },
      ]);
      expect(detectLoops(db, {}, undefined, { minRepeats: 2 }).data.incidents).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("keeps flagging an edit that repeats itself, which must not split on its own writes", () => {
    const db = new DatabaseSync(":memory:");
    try {
      seed(db, [
        { tool: "edit", input: { filePath: FILE, content: "same" }, at: 10 },
        { tool: "edit", input: { filePath: FILE, content: "same" }, at: 20 },
        { tool: "edit", input: { filePath: FILE, content: "same" }, at: 30 },
      ]);
      const incidents = detectLoops(db).data.incidents;
      expect(incidents).toHaveLength(1);
      expect(incidents[0]?.calls).toBe(3);
      expect(incidents[0]?.interveningCalls).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe("what counts as a loop by default", () => {
  it("does not report a bare pair, because a pair is usually ordinary work", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(FIXTURE_SCHEMA_SQL);
      db.prepare(
        "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('s1','global','s1','/','s1','1.17.7',0,999)",
      ).run();
      db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('m1','s1',0,0,?)").run(
        JSON.stringify({ role: "assistant", modelID: "m", providerID: "p", tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 0, completed: 1 } }),
      );
      for (const [index, at] of [10, 20, 30].entries()) {
        db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,'m1','s1',?,?,?)").run(
          `p${index}`, at, at,
          JSON.stringify({ type: "tool", tool: "bash", callID: `c${index}`, state: { status: "completed", input: { command: "pnpm build" }, output: "failed", metadata: {}, title: "bash", time: { start: at, end: at + 1 } } }),
        );
      }

      // Two of the three is a pair — not reported. All three is a loop.
      const pairOnly = detectLoops(db, { to: 25 }).data.incidents;
      expect(pairOnly).toHaveLength(0);

      const all = detectLoops(db).data.incidents;
      expect(all).toHaveLength(1);
      expect(all[0]?.calls).toBe(3);
      expect(all[0]?.tool).toBe("bash");
    } finally {
      db.close();
    }
  });

  it("ranks a failing retry above a redundant repeat, whatever their costs", () => {
    withFixture((db) => {
      const { data } = detectLoops(db, {}, PRICING);
      const kinds = data.incidents.map((incident) => incident.kind);
      const firstRepeat = kinds.indexOf("redundant-repeat");
      const lastRetry = kinds.lastIndexOf("error-retry");
      if (firstRepeat !== -1 && lastRetry !== -1) expect(lastRetry).toBeLessThan(firstRepeat);
    });
  });
});
