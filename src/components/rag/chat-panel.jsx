"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, History, Loader2, Plus, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRagChat } from "@/components/rag/use-rag-chat";
import { Message } from "@/components/rag/message";
import { SourceCard } from "@/components/rag/source-card";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Summarise my most recent documents",
  "What did we decide about permissions?",
  "Where is authentication described?",
];

const SCOPE_OPTIONS = {
  all: "All my documents",
  document: "This document",
  folder: "This folder",
};

/**
 * The chat surface shared by the dashboard sheet and the editor.
 *
 * Styled from the same primitives as the rest of the app: `border-border` /
 * `bg-card` surfaces, the standard Button sizes, `Select` for the scope (the
 * dashboard's own pattern), and the muted-foreground type scale.
 */
export function ChatPanel({ documentId = null, folderId = null, className }) {
  const [scopeType, setScopeType] = useState(documentId ? "document" : folderId ? "folder" : "all");
  const [input, setInput] = useState("");
  const [showThreads, setShowThreads] = useState(false);

  const scope =
    scopeType === "document" && documentId
      ? { type: "document", documentId }
      : scopeType === "folder" && folderId
        ? { type: "folder", folderId }
        : { type: "all" };

  const scopeOptions = [
    ...(documentId ? ["document"] : []),
    ...(folderId ? ["folder"] : []),
    "all",
  ];

  const chat = useRagChat({ scope });
  const bottomRef = useRef(null);

  const busy = chat.status === "searching" || chat.status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [chat.messages, chat.status]);

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    chat.send(text);
  }

  function onKeyDown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape" && busy) {
      chat.stop();
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowThreads((value) => !value)}
          aria-pressed={showThreads}
        >
          <History className="h-4 w-4" />
          History
        </Button>
        <Button variant="ghost" size="sm" onClick={chat.newThread}>
          <Plus className="h-4 w-4" />
          New
        </Button>
        {scopeOptions.length > 1 ? (
          <Select value={scopeType} onValueChange={setScopeType}>
            <SelectTrigger className="ml-auto h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scopeOptions.map((type) => (
                <SelectItem key={type} value={type}>
                  {SCOPE_OPTIONS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="ml-auto pr-1 text-xs text-muted-foreground">{SCOPE_OPTIONS.all}</span>
        )}
      </div>

      {showThreads ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {chat.threads.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No conversations yet. Ask a question to start one.
            </p>
          ) : (
            <ul>
              {chat.threads.map((thread) => (
                <li key={thread.id} className="mb-1">
                  <button
                    type="button"
                    onClick={() => {
                      chat.openThread(thread.id);
                      setShowThreads(false);
                    }}
                    className={cn(
                      "w-full truncate rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent",
                      thread.id === chat.threadId && "bg-accent font-medium"
                    )}
                  >
                    {thread.title || "Untitled conversation"}
                    <span className="block text-xs text-muted-foreground">
                      {new Date(thread.updatedAt).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {chat.messages.length === 0 && chat.status !== "error" ? (
            <div className="mt-8 flex flex-col items-center text-center">
              <Sparkles className="h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 max-w-xs text-sm text-muted-foreground">
                Ask anything across {SCOPE_OPTIONS[scopeType].toLowerCase()}. Answers cite the
                documents they come from.
              </p>
              <div className="mt-4 flex w-full flex-col gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="outline"
                    size="sm"
                    className="h-auto justify-start whitespace-normal py-1.5 text-left"
                    onClick={() => chat.send(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {chat.messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              onCitation={(citation, index) => {
                const source = chat.sources[index - 1];
                const documentId = source?.documentId ?? citation?.documentId;
                if (documentId) window.open(`/documents/${documentId}`, "_blank");
              }}
            />
          ))}

          {chat.status === "searching" ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching your documents…
            </p>
          ) : null}

          {chat.sources.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sources
              </p>
              {chat.sources.map((source, index) => (
                <SourceCard key={source.chunkId} source={source} index={index + 1} />
              ))}
            </div>
          ) : null}

          {chat.error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
              {chat.error}
            </p>
          ) : null}

          <div ref={bottomRef} />
        </div>
      )}

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-1.5 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about your documents…"
            rows={2}
            className="max-h-32 min-h-[2.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          {busy ? (
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={chat.stop}
              title="Stop (Esc)"
              aria-label="Stop"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-8 w-8"
              onClick={submit}
              disabled={!input.trim()}
              title="Send (Ctrl/Cmd+Enter)"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-xs text-muted-foreground">
          Answers come only from documents you own. Ctrl/Cmd+Enter sends, Esc stops.
        </p>
      </div>
    </div>
  );
}
