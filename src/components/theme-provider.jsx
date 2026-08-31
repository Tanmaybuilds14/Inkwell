"use client";

import * as React from "react";

const STORAGE_KEY = "inkwell-theme";

const ThemeContext = React.createContext({
  theme: "system",
  setTheme: () => {},
  resolvedTheme: "light",
});

/**
 * Theme provider with system/light/dark support.
 * Defaults to "system" — follows the user's OS preference.
 * The choice is persisted to localStorage and toggled with a class on <html>.
 */
export function ThemeProvider({ children, defaultTheme = "system" }) {
  // Lazy init from localStorage — avoids a flash of wrong theme + avoids
  // calling setState synchronously inside an effect (react-hooks lint rule).
  const [theme, setThemeState] = React.useState(() => {
    if (typeof window === "undefined") return defaultTheme;
    return localStorage.getItem(STORAGE_KEY) ?? defaultTheme;
  });
  const [resolvedTheme, setResolvedTheme] = React.useState("light");

  // Resolve system preference + apply/remove the .dark class on <html>.
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const apply = (t) => {
      const next = t === "system" ? (mq.matches ? "dark" : "light") : t;
      setResolvedTheme(next);
      if (next === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    };

    apply(theme);

    const onChange = () => {
      if (theme === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = React.useCallback((next) => {
    localStorage.setItem(STORAGE_KEY, next);
    setThemeState(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return React.useContext(ThemeContext);
}
