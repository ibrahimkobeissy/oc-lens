import { describe, expect, it } from "vitest";

import { shouldHandleSearchShortcut } from "./global-search";

function shortcut(overrides: Partial<Parameters<typeof shouldHandleSearchShortcut>[0]> = {}) {
  return {
    key: "k",
    metaKey: true,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    repeat: false,
    ...overrides,
  };
}

describe("OCL-142 global search shortcut guard", () => {
  it("opens normally and still toggles its own open palette", () => {
    expect(shouldHandleSearchShortcut(shortcut(), false, false)).toBe(true);
    expect(shouldHandleSearchShortcut(shortcut(), true, true)).toBe(true);
    expect(shouldHandleSearchShortcut(shortcut({ metaKey: false, ctrlKey: true }), false, false)).toBe(true);
  });

  it("ignores handled, composing, repeated, and dialog-stacking events", () => {
    expect(shouldHandleSearchShortcut(shortcut({ defaultPrevented: true }), false, false)).toBe(false);
    expect(shouldHandleSearchShortcut(shortcut({ isComposing: true }), false, false)).toBe(false);
    expect(shouldHandleSearchShortcut(shortcut({ repeat: true }), false, false)).toBe(false);
    expect(shouldHandleSearchShortcut(shortcut(), false, true)).toBe(false);
  });
});
