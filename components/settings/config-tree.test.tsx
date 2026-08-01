import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfigTree } from "./config-tree";

describe("OCL-111 redacted config tree", () => {
  it("renders nested objects and arrays as collapsible nodes with terminal redacted chips", () => {
    const markup = renderToStaticMarkup(<ConfigTree value={{
      agent: { build: { mode: "primary", prompt: "[redacted]" } },
      mcp: [{ type: "remote", token: "[redacted]" }],
      enabled: true,
    }} />);

    expect(markup).toContain("<details");
    expect(markup).toContain("Object(1)");
    expect(markup).toContain("Array(1)");
    expect(markup.match(/\[redacted\]/g)).toHaveLength(2);
    expect(markup).toContain("Redacted value; the original value is not available");
    expect(markup).toContain('>&quot;primary&quot;</span>');
    expect(markup).not.toContain("type=\"button\"");
  });

  it("renders a clear state for an empty config object", () => {
    expect(renderToStaticMarkup(<ConfigTree value={{}} />)).toContain("The config object is empty.");
  });
});
