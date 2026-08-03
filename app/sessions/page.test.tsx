import { describe, expect, it } from "vitest";

import { encodedFilterValue, filterValuesFromParams } from "./page";

describe("encodedFilterValue", () => {
  it("preserves a raw text value verbatim, including internal and trailing spaces", () => {
    expect(encodedFilterValue("search", "hello world")).toBe("hello world");
    expect(encodedFilterValue("search", "hello ")).toBe("hello ");
    expect(encodedFilterValue("project", "oc l")).toBe("oc l");
  });

  it("still converts from/to date-input values to epoch strings", () => {
    expect(encodedFilterValue("from", "2026-01-15")).toMatch(/^\d+$/);
    expect(encodedFilterValue("to", "")).toBe("");
  });
});

describe("filterValuesFromParams round-trip", () => {
  it("does not lose a trailing space when a value is stored and read back through the URL", () => {
    const params = new URLSearchParams();
    const encoded = encodedFilterValue("search", "hello wor");
    params.set("search", encoded);
    expect(filterValuesFromParams(params).search).toBe("hello wor");
  });
});
