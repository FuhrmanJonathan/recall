"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/schedule", label: "Schedule" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/cards", label: "Card" },
];

export default function MenuButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // Close when you navigate to a new page
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on outside click or Escape
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Open menu"
        aria-expanded={open}
        className="rounded p-1 hover:bg-sky-700"
      >
        {/* Hamburger icon */}
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none"
             stroke="white" strokeWidth="2" strokeLinecap="round">
          <line x1="3" y1="7" x2="27" y2="7" />
          <line x1="3" y1="15" x2="27" y2="15" />
          <line x1="3" y1="23" x2="27" y2="23" />
        </svg>
      </button>

      {open && (
        <nav className="absolute right-0 mt-2 w-35 rounded-lg border bg-white py-1 shadow-lg">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block px-3 py-2 text-black items-center hover:bg-gray-100"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}