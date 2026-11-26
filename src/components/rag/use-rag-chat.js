"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Chat state + the SSE client for /api/rag/chat.
 *
 * The event contract is `sources → delta… → done | error` (PLAN §7.6): sources
 * arrive before the first token so citation chips render while the answer
 * types, and `done.messageId` replaces the optimistic message id.
 */

function parseFrame(frame) {
  let event = "message";
  const dataLines = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export function useRagChat({ scope }) {
  const [threads, setThreads] = useState([]);
  const [threadId, setThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sources, setSources] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | searching | streaming | error
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const refreshThreads = useCallback(async () => {
    try {
      const response = await fetch("/api/rag/threads", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setThreads(data.threads ?? []);
    } catch {
      // A thread list that fails to load is cosmetic; chatting still works.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/rag/threads", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setThreads(data.threads ?? []);
      } catch {
        // A thread list that fails to load is cosmetic; chatting still works.
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  const openThread = useCallback(async (id) => {
    abortRef.current?.abort();
    setStatus("idle");
    setError(null);
    setSources([]);
    setThreadId(id);
    try {
      const response = await fetch(`/api/rag/threads/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not open that conversation");
      const data = await response.json();
      setMessages(data.messages ?? []);
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  const newThread = useCallback(() => {
    abortRef.current?.abort();
    setThreadId(null);
    setMessages([]);
    setSources([]);
    setError(null);
    setStatus("idle");
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const updateAssistant = useCallback((updater) => {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === "assistant") {
          next[i] = updater(next[i]);
          break;
        }
      }
      return next;
    });
  }, []);

  const send = useCallback(
    async (text) => {
      const question = (text ?? "").trim();
      if (!question) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const stamp = Date.now();
      setMessages((prev) => [
        ...prev,
        { id: `local-user-${stamp}`, role: "user", content: question },
        { id: `local-assistant-${stamp}`, role: "assistant", content: "", pending: true },
      ]);
      setSources([]);
      setError(null);
      setStatus("searching");

      try {
        const response = await fetch("/api/rag/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, message: question, scope }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? `Request failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let receivedSources = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const parsed = parseFrame(frame);
            boundary = buffer.indexOf("\n\n");
            if (!parsed) continue;

            if (parsed.event === "sources") {
              receivedSources = true;
              setSources(parsed.data.sources ?? []);
              setStatus("streaming");
              if (parsed.data.threadId) setThreadId(parsed.data.threadId);
            } else if (parsed.event === "delta") {
              const delta = parsed.data?.text ?? "";
              updateAssistant((message) => ({ ...message, content: message.content + delta, pending: false }));
            } else if (parsed.event === "done") {
              updateAssistant((message) => ({ ...message, id: parsed.data.messageId ?? message.id, pending: false }));
              setStatus("idle");
              refreshThreads();
            } else if (parsed.event === "error") {
              const hint = parsed.data?.hint ? ` ${parsed.data.hint}` : "";
              setError(`${parsed.data?.message ?? "Something went wrong."}${hint}`);
              setStatus("error");
              // Remove the empty optimistic bubble; keep any partial text.
              setMessages((prev) =>
                prev.filter((message) => !(message.role === "assistant" && !message.content))
              );
              if (parsed.data?.threadId) setThreadId(parsed.data.threadId);
            }
          }
        }

        if (!receivedSources) setStatus((current) => (current === "error" ? current : "idle"));
      } catch (err) {
        if (err.name === "AbortError") {
          updateAssistant((message) => ({ ...message, pending: false }));
          setStatus("idle");
          return;
        }
        setError(err.message);
        setStatus("error");
        setMessages((prev) => prev.filter((message) => !(message.role === "assistant" && !message.content)));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [threadId, scope, refreshThreads, updateAssistant]
  );

  return {
    threads,
    threadId,
    messages,
    sources,
    status,
    error,
    send,
    stop,
    openThread,
    newThread,
    refreshThreads,
  };
}
