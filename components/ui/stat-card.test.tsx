import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatCard } from "./stat-card";

describe("OCL-142 StatCard tooltip accessibility", () => {
  it("uses a named keyboard-focusable tooltip trigger", () => {
    const markup = renderToStaticMarkup(<StatCard label="Sessions" value={4} tooltip="Recorded sessions" />);
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*aria-label="Recorded sessions"/);
  });
});
