"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";
const THEME_KEY = "shipmentos.theme";
const listeners = new Set<() => void>();

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage unavailable: the choice lasts for this page view only */
  }
  listeners.forEach((l) => l());
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="grid size-9 flex-none place-items-center rounded-lg text-muted transition-colors hover:bg-active hover:text-text"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      data-testid="theme-toggle"
    >
      <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {dark ? (
          <>
            <circle cx="8" cy="8" r="2.8" />
            <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
          </>
        ) : (
          <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
        )}
      </svg>
    </button>
  );
}
