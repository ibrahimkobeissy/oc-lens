import { describe, expect, it } from "vitest";
import { withFixture, withEmptyFixture } from "../../../test/fixtures";
import { LOOP_SCENARIOS, SKILL_NAMES } from "../../../test/fixtures/manifest";
import { loopDiagnostics } from "../loop-report";

/**
 * The report is meant to leave the machine that produced it, so the redaction
 * property is the point of this file — a leak here would exfiltrate shell
 * command lines and file contents from the user's entire agent history.
 */

describe("redaction — the report carries shape, never values", () => {
  it("contains no value from the database anywhere in its serialised form", () => {
    withFixture((db) => {
      const json = JSON.stringify(loopDiagnostics(db).data);

      // Tool-input values planted by the loop scenarios.
      expect(json).not.toContain("/home/dev/web-app/src/auth/session.ts");
      expect(json).not.toContain("pnpm test --filter auth");
      expect(json).not.toContain("export const SESSION_TTL");
      expect(json).not.toContain("export { handler }");

      // Values from the randomly generated population.
      expect(json).not.toContain("/tmp/oc-lens-fixture/");
      expect(json).not.toContain("echo fixture");
      expect(json).not.toContain("https://example.com");
      expect(json).not.toContain("ENOENT");

      // Skill names are `state.input.name` *values*, not key names.
      for (const skill of SKILL_NAMES) expect(json).not.toContain(skill);

      // No row identifiers of any kind.
      expect(json).not.toContain("ses_0");
      expect(json).not.toContain("msg_0");
      expect(json).not.toContain("prt_");
      expect(json).not.toContain("call_");
    });
  });

  it("emits no absolute filesystem path at all", () => {
    withFixture((db) => {
      const json = JSON.stringify(loopDiagnostics(db).data);
      expect(json).not.toMatch(/"\/|\/home\/|\/tmp\/|\/Users\//);
    });
  });

  it("declares its own policy inside the payload, so the file is self-describing", () => {
    withFixture((db) => {
      const { data } = loopDiagnostics(db);
      expect(data.redaction.valuesIncluded).toBe(false);
      expect(data.redaction.note.length).toBeGreaterThan(0);
    });
  });
});

describe("shape evidence — what the report is actually for", () => {
  it("reports input key names and their JSON types per tool", () => {
    withFixture((db) => {
      const { data } = loopDiagnostics(db);
      const read = data.tools.find((t) => t.tool === "read");
      expect(read?.inputKeys.map((k) => k.key)).toEqual(["filePath"]);
      expect(read?.inputKeys[0]?.jsonTypes).toEqual(["string"]);

      const edit = data.tools.find((t) => t.tool === "edit");
      expect(edit?.inputKeys.map((k) => k.key).sort()).toEqual(["content", "filePath"]);

      const bash = data.tools.find((t) => t.tool === "bash");
      expect(bash?.inputKeys.map((k) => k.key)).toEqual(["command"]);
    });
  });

  it("shows which tools record no input, the question the whole report exists to answer", () => {
    withFixture((db) => {
      const { data } = loopDiagnostics(db);
      const glob = data.tools.find((t) => t.tool === "glob");
      expect(glob?.calls).toBeGreaterThan(0);
      expect(glob?.signaturable).toBe(0);
      expect(glob?.inputKeys).toEqual([]);
      expect(data.coverage.unsignaturableTools).toContain("glob");
      expect(data.coverage.unsignaturable).toBeGreaterThan(0);
    });
  });

  it("counts repeats within a session, never across sessions", () => {
    withFixture((db) => {
      const { data } = loopDiagnostics(db, { sessionId: LOOP_SCENARIOS.redundantRepeat.sessionId });
      const read = data.tools.find((t) => t.tool === "read");
      expect(read?.calls).toBe(5);
      expect(read?.distinctSignatures).toBe(1);
      expect(read?.maxRepeatInSession).toBe(5);
      expect(read?.repeatHistogram).toEqual([{ repeats: 5, signatures: 1 }]);
    });
  });

  it("reports scale and opencode versions so a shape can be tied to a release", () => {
    withFixture((db) => {
      const { data } = loopDiagnostics(db);
      expect(data.scale.sessions).toBe(126);
      expect(data.scale.toolCalls).toBeGreaterThan(2_000);
      expect(data.opencodeVersions.map((v) => v.version)).toContain("1.17.7");
    });
  });
});

describe("threshold sweep", () => {
  it("sweeps minRepeats so a threshold can be chosen from evidence", () => {
    withFixture((db) => {
      const { data } = loopDiagnostics(db);
      expect(data.thresholdSweep.map((s) => s.minRepeats)).toEqual([2, 3, 4, 5]);

      // Raising the bar can never surface more incidents than a lower one did.
      for (let i = 1; i < data.thresholdSweep.length; i++) {
        const previous = data.thresholdSweep[i - 1];
        const current = data.thresholdSweep[i];
        expect(current?.incidents).toBeLessThanOrEqual(previous?.incidents ?? 0);
      }

      const atTwo = data.thresholdSweep[0];
      expect(atTwo?.incidents).toBeGreaterThan(0);
      expect(atTwo?.byKind.map((k) => k.kind).sort()).toEqual([
        "error-retry",
        "oscillation",
        "redundant-repeat",
      ]);
    });
  });
});

describe("honest degradation", () => {
  it("returns a well-formed empty report on an empty database", () => {
    withEmptyFixture((db) => {
      const { data } = loopDiagnostics(db);
      expect(data.scale).toEqual({ sessions: 0, messages: 0, parts: 0, toolCalls: 0 });
      expect(data.tools).toEqual([]);
      expect(data.opencodeVersions).toEqual([]);
      expect(data.coverage.toolCalls).toBe(0);
      expect(data.thresholdSweep.every((s) => s.incidents === 0)).toBe(true);
      expect(data.redaction.valuesIncluded).toBe(false);
    });
  });
});
