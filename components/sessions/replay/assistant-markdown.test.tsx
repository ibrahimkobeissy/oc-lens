import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssistantMarkdown, safeHref } from "./assistant-markdown";

describe("AssistantMarkdown", () => {
  it("renders GFM tables, lists, and syntax-highlighted fences", () => {
    const markdown = `| Name | Value |\n| --- | --- |\n| one | 1 |\n\n- first\n- second\n\n\`\`\`ts\nconst value = 1\n\`\`\``;
    const html = renderToStaticMarkup(<AssistantMarkdown content={markdown} />);
    expect(html).toContain("<table");
    expect(html).toContain("<ul");
    expect(html).toContain("const");
    expect(html).toContain("language-ts");
  });

  it("allows only absolute HTTP(S) links and never navigates the app frame", () => {
    expect(safeHref("https://example.com/path")).toBe("https://example.com/path");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("/sessions/private")).toBeNull();
    const html = renderToStaticMarkup(<AssistantMarkdown content="[safe](https://example.com) [bad](javascript:alert(1))" />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="nofollow noopener noreferrer"');
    expect(html).not.toContain("javascript:");
  });

  it("renders remote Markdown images as inert labelled placeholders", () => {
    const html = renderToStaticMarkup(<AssistantMarkdown content="![private diagram](https://tracker.invalid/pixel?session=secret)" />);

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Blocked image: private diagram"');
    expect(html).toContain("Blocked image: private diagram");
    expect(html).not.toContain("tracker.invalid");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('rel="preload"');
    expect(html).not.toContain('src="');
  });

  it("collapses long content with an explicit expansion control", () => {
    const html = renderToStaticMarkup(<AssistantMarkdown content={"long response ".repeat(400)} />);
    expect(html).toContain("max-h-96");
    expect(html).toContain("Show full response");
  });
});
