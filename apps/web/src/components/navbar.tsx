"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { Wordmark } from "@/components/ui";

const appLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/decks", label: "My Decks" },
  { href: "/cards", label: "Cards" },
  { href: "/schedule", label: "Schedule" },
];

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  async function onLogout() {
    // Leave the page first so a logged-in-only page doesn't bounce to /login.
    router.push("/");
    await logout();
  }

  const linkClass = (href: string) =>
    `whitespace-nowrap rounded-md px-2 py-1.5 transition sm:px-3 ${
      pathname === href
        ? "bg-gray-100 font-medium text-ink"
        : "text-ink/60 hover:text-ink"
    }`;

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <Link href={user ? "/dashboard" : "/"} className="shrink-0">
          <Wordmark />
        </Link>

        {!loading && (
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {user ? (
              <>
                {appLinks.map((link) => (
                  <Link key={link.href} href={link.href} className={linkClass(link.href)}>
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
    </header>
  );
}
