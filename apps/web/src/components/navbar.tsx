"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { canLeavePage } from "@/components/use-leave-guard";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { Wordmark } from "@/components/ui";

const appLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/decks", label: "My Decks" },
  { href: "/cards", label: "Study" },
  { href: "/schedule", label: "Reminders" },
];

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => setLogoutError(""), [pathname]);

  async function onLogout() {
    if (loggingOut || !canLeavePage()) return;
    setLoggingOut(true); setLogoutError("");
    try { await logout(); router.replace("/"); }
    catch { setLogoutError("Could not log out. Please try again."); }
    finally { setLoggingOut(false); }
  }

  const linkClass = (href: string) =>
    `flex-1 text-center sm:flex-none whitespace-nowrap rounded-md px-2 py-1.5 transition sm:px-3 ${
      (pathname === href || pathname.startsWith(`${href}/`))
        ? "bg-blue-50 font-medium text-accent"
        : "text-gray-600 hover:bg-gray-50 hover:text-ink"
    }`;

  return (
    <header className="relative border-b border-gray-200/80 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Link href={user ? "/dashboard" : "/"} className="shrink-0">
          <Wordmark />
        </Link>

        {!loading && (
          <nav className={`flex flex-wrap items-center gap-1 text-sm sm:gap-2 sm:text-base ${user ? "w-full sm:w-auto" : ""}`}>
            {user ? (
              <>
                {appLinks.map((link) => (
                  <Link key={link.href} href={link.href} aria-current={(pathname === link.href || pathname.startsWith(`${link.href}/`)) ? "page" : undefined} className={linkClass(link.href)}>
                    {link.label}
                  </Link>
                ))}
                <button
                  disabled={loggingOut}
                  onClick={onLogout}
                  className="absolute right-4 top-5 sm:static sm:ml-1 whitespace-nowrap rounded-md px-2 py-1.5 text-ink/60 transition hover:text-ink sm:px-3"
                >
                  {loggingOut ? "Logging out…" : "Log out"}
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className={linkClass("/login")}>
                  Log in
                </Link>
                <Link href="/signup" className="whitespace-nowrap rounded-md bg-accent px-3 py-1.5 font-medium text-white transition hover:bg-accent-dark">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        )}
      </div>
      {logoutError && <p role="alert" className="mx-auto max-w-6xl px-4 pb-3 text-sm text-red-800">{logoutError}</p>}
    </header>
  );
}
