"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const storageKey = "recall-theme";

function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === "light" || value === "dark") return value;
  } catch { /* Keep light mode when storage is unavailable. */ }
  return "light";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const apply = () => {
      const resolved = savedTheme();
      document.documentElement.dataset.theme = resolved;
      setTheme(resolved);
    };
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      apply();
    };
    apply();
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("storage", sync);
    };
  }, []);

  function toggle() {
    const value = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    setTheme(value);
    document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem(storageKey, value);
    } catch { /* The selection still works for this visit. */ }
  }

  const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
  return <button type="button" aria-label={label} title={label} onClick={toggle}
    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-600 transition-colors hover:bg-gray-100 hover:text-ink">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {theme === "dark" ? <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
      </> : <path d="M20.9 13.3A9 9 0 0 1 10.7 3.1a9 9 0 1 0 10.2 10.2Z" />}
    </svg>
  </button>;
}
