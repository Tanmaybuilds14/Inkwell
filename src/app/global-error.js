"use client";

import { useEffect, useState } from "react";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { Feather } from "lucide-react";
import { reportError } from "@/lib/error-reporting";

// global-error.js replaces the root layout when active, so it must define
// its own <html>/<body> and load the fonts + theme itself (global styles,
// Tailwind and providers are NOT available here).
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/**
 * Global error boundary (app/global-error.js convention).
 * Catches errors thrown in the root layout/template itself — the last
 * line of defense when app/error.js can't handle them.
 */
export default function GlobalError({ error, retry }) {
  // Match the app's light/dark theme by reading the same localStorage key
  // the ThemeProvider uses; fall back to the OS preference. Lazy init from
  // window avoids a setState-in-effect (server render has no window).
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem("inkwell-theme");
    return stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    // The root layout crashed, so this is the only place left to report from.
    reportError(error, { scope: "global-error" });
  }, [error]);

  return (
    <html
      lang="en"
      className={`${outfit.variable} ${jetbrains.variable} h-full antialiased ${dark ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          textAlign: "center",
          // Inline theme tokens (globals.css isn't loaded on this page).
          backgroundColor: dark ? "#0c0a09" : "#fafaf9",
          color: dark ? "#fafaf9" : "#1c1917",
          fontFamily:
            "var(--font-outfit), ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <main className="flex flex-col items-center justify-center text-center">
          <span
            style={{
              display: "flex",
              height: "3rem",
              width: "3rem",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "9999px",
              border: `1px solid ${dark ? "rgba(239, 68, 68, 0.3)" : "rgba(220, 38, 38, 0.3)"}`,
              backgroundColor: dark ? "rgba(239, 68, 68, 0.1)" : "rgba(220, 38, 38, 0.1)",
            }}
          >
            <Feather
              style={{ height: "1.5rem", width: "1.5rem", color: dark ? "#ef4444" : "#dc2626" }}
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </span>
          <h1
            style={{
              marginTop: "1.5rem",
              fontSize: "1.875rem",
              fontWeight: 300,
              letterSpacing: "-0.02em",
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              marginTop: "0.75rem",
              maxWidth: "26rem",
              fontSize: "0.875rem",
              lineHeight: 1.6,
              color: dark ? "#a8a29e" : "#78716c",
            }}
          >
            Inkwell hit an unexpected error and couldn&apos;t recover. Reloading
            usually fixes it — if it persists, try signing in again.
          </p>
          {error?.digest ? (
            <p
              style={{
                marginTop: "0.75rem",
                fontFamily: "var(--font-jetbrains), ui-monospace, monospace",
                fontSize: "0.75rem",
                color: dark ? "#a8a29e" : "#78716c",
              }}
            >
              Error ID: {error.digest}
            </p>
          ) : null}
          <div style={{ marginTop: "2rem", display: "flex", gap: "0.75rem" }}>
            <button
              onClick={() => retry()}
              style={{
                cursor: "pointer",
                borderRadius: "0.5rem",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "none",
                backgroundColor: dark ? "#fafaf9" : "#18181b",
                color: dark ? "#18181b" : "#fafaf9",
              }}
            >
              Try again
            </button>
            <button
              // Intentional hard navigation: the client router lives in the
              // root layout that just crashed, so a full reload is the only
              // reliable way home.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              onClick={() => window.location.assign("/")}
              style={{
                cursor: "pointer",
                borderRadius: "0.5rem",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                textDecoration: "none",
                border: `1px solid ${dark ? "#292524" : "#e7e5e4"}`,
                color: "inherit",
                backgroundColor: "transparent",
              }}
            >
              Go home
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
