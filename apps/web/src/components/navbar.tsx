
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import { useAuth } from "@/components/auth";
import { Wordmark } from "@/components/ui";

const appLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/decks", label: "My Decks" },
  { href: "/cards", label: "Cards" },
  { href: "/schedule", label: "Schedule" },
  { href: "/explore", label: "Explore" },
];

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");

  async function onLogout() {
    router.push("/");
    await logout();
  }

  const linkClass = (href: string) =>
    `whitespace-nowrap rounded-md px-2 py-1.5 transition sm:px-3 ${
      pathname === href
        ? "bg-gray-100 font-medium text-ink"
        : "text-ink/60 hover:text-ink"
    }`;

  function handleSearch(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();

    const query = search.trim();
    if (!query) return;

    router.push(`/explore?q=${encodeURIComponent(query)}`);
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">

        <Link
          href={user ? "/dashboard" : "/"}
          className="shrink-0"
        >
          <Wordmark />
        </Link>

        {!loading && user && (
          <form
            onSubmit={handleSearch}
            role="search"
            className="order-3 w-full sm:order-none sm:min-w-40 sm:max-w-xs sm:flex-1"
          >
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search flashcards..."
              aria-label="Search public flashcards"
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            />
          </form>
        )}

        {!loading && (
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {user ? (
              <>
                {appLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={linkClass(link.href)}
                  >
                    {link.label}
                  </Link>
                ))}

                <button
                  onClick={onLogout}
                  className="ml-1 whitespace-nowrap rounded-md px-2 py-1.5 text-ink/60 transition hover:text-ink sm:px-3"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className={linkClass("/login")}
                >
                  Log in
                </Link>

                <Link
                  href="/signup"
                  className="whitespace-nowrap rounded-md bg-accent px-3 py-1.5 font-medium text-white transition hover:bg-accent-dark"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
