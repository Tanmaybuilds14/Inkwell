"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const VARIANTS = {
  default: "border-border bg-popover text-popover-foreground",
  success: "border-emerald-500/30 bg-popover text-popover-foreground",
  destructive: "border-destructive/30 bg-popover text-destructive",
};

const ICONS = {
  success: CheckCircle2,
  destructive: AlertCircle,
};

const MAX_VISIBLE = 5;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (opts) => {
      const { title, description, variant = "default", duration = 4000 } =
        typeof opts === "string" ? { title: opts } : opts;
      const id = ++idRef.current;
      setToasts((list) => [...list, { id, title, description, variant }].slice(-MAX_VISIBLE));
      if (duration > 0) {
        timersRef.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        );
      }
      return id;
    },
    [dismiss]
  );

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
    },
    []
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Above Radix overlays (z-50) so toasts fired from dialogs stay visible */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-2"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.variant];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg",
                "animate-in fade-in-0 zoom-in-95",
                VARIANTS[t.variant] ?? VARIANTS.default
              )}
            >
              {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0" /> : null}
              <div className="flex-1">
                <p className="font-medium leading-snug">{t.title}</p>
                {t.description ? (
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {t.description}
                  </p>
                ) : null}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 opacity-50 transition-opacity hover:opacity-100 focus:outline-none"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
