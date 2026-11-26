"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Copies a block of commands to the clipboard and confirms it briefly.
 *
 * Fails quietly: the clipboard API is unavailable on insecure origins and can
 * be denied by permissions, in which case the code block is still there to
 * select by hand — the button just does nothing visible.
 */
export function CopyButton({ value, label = "Copy", className }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — nothing to do; the block stays selectable.
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:outline-none",
        // Callers on a dark surface pass their own tone; the terminal block
        // does, because the landing page's muted ink is unreadable on #12100f.
        className
      )}
    >
      {copied ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}

/** A terminal-styled block with an optional copy button. */
export function CommandBlock({ label, children, value }) {
  return (
    <div className="mockup-surface-dark overflow-hidden rounded-xl">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <span className="font-mono text-[11px] text-stone-400">{label}</span>
        <CopyButton
          value={value}
          className="text-stone-400 hover:text-stone-100"
        />
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-relaxed text-stone-300">
        <code>{children}</code>
      </pre>
    </div>
  );
}
