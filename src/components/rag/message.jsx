"use client";

import { useMemo } from "react";
import { marked } from "marked";

/**
 * A chat message.
 *
 * Assistant text is rendered as Markdown (`marked` is already a dependency).
 * The model's output is untrusted — a retrieved document can contain HTML —
 * so raw HTML is escaped before parsing: markdown structure survives, tags do
 * not. Typography uses the app's border/muted tokens rather than a prose
 * plugin, which this project does not install.
 */
function renderMarkdown(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return marked.parse(escaped, { breaks: true, gfm: true });
}

export function Message({ message, onCitation }) {
  const html = useMemo(
    () => (message.role === "assistant" && message.content ? renderMarkdown(message.content) : ""),
    [message.role, message.content]
  );

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  const citations = Array.isArray(message.citations) ? message.citations : [];

  return (
    <div className="space-y-2">
      <div
        className={[
          "max-w-none break-words text-sm leading-relaxed",
          "[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
          "[&_ul]:my-1.5 [&_ol]:my-1.5 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5",
          "[&_li]:my-0.5 [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-3 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold",
          "[&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs",
          "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-secondary [&_pre]:p-2 [&_pre]:text-xs",
          "[&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        ].join(" ")}
        // Escaped above: only markdown-generated tags can appear here.
        dangerouslySetInnerHTML={{ __html: html || (message.pending ? "…" : "") }}
      />

      {citations.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {citations.map((citation, index) => (
            <button
              key={`${citation.chunkId}-${index}`}
              type="button"
              onClick={() => onCitation?.(citation, index + 1)}
              title={`${citation.title}${citation.headingPath ? ` — ${citation.headingPath}` : ""}`}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              [{index + 1}] {citation.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
