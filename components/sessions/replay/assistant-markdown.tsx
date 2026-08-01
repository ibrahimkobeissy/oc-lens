"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ChevronDown, ChevronUp, ImageOff, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COLLAPSE_THRESHOLD = 4_000;

function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function SafeLink({ href, children }: { href?: string; children?: ReactNode }) {
  const safe = safeHref(href);
  if (safe === null) return <span className="inline-flex items-center gap-1 text-muted-foreground" title="Unsafe or relative link blocked"><ShieldAlert aria-hidden="true" className="size-3" />{children}</span>;
  return <a href={safe} target="_blank" rel="nofollow noopener noreferrer" referrerPolicy="no-referrer" className="font-medium text-primary underline underline-offset-2">{children}</a>;
}

export function AssistantMarkdown({ content, className }: { content: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = content.length > COLLAPSE_THRESHOLD;
  return <div className={cn("text-sm text-foreground", className)}>
    <div className={cn("relative", collapsible && !expanded && "max-h-96 overflow-hidden")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          h1: ({ children }) => <h1 className="mb-2 mt-4 border-b border-border pb-1 text-lg font-bold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed [&>p]:my-0">{children}</li>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">{children}</blockquote>,
          a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
          img: ({ alt }) => {
            const label = alt ? `Blocked image: ${alt}` : "Blocked image";
            return <span role="img" aria-label={label} className="inline-flex items-center gap-1.5 rounded border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"><ImageOff aria-hidden="true" className="size-3.5" /><span>{label}</span></span>;
          },
          table: ({ children }) => <div className="my-3 overflow-x-auto rounded-md border border-border"><table className="w-full min-w-64 border-collapse text-xs">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => <th className="border-b border-border px-2 py-1.5 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border-b border-border px-2 py-1.5 align-top">{children}</td>,
          code: ({ className: codeClassName, children }) => {
            const language = /language-([\w-]+)/.exec(codeClassName ?? "")?.[1];
            if (language) return <SyntaxHighlighter language={language} style={oneDark} PreTag="div" customStyle={{ margin: "0.75rem 0", borderRadius: "0.5rem", fontSize: "0.8rem" }}>{String(children).replace(/\n$/, "")}</SyntaxHighlighter>;
            return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{children}</code>;
          },
        }}
      >{content}</ReactMarkdown>
      {collapsible && !expanded ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-card to-transparent" /> : null}
    </div>
    {collapsible ? <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setExpanded((value) => !value)}>{expanded ? <><ChevronUp />Show less</> : <><ChevronDown />Show full response</>}</Button> : null}
  </div>;
}

export { safeHref };
