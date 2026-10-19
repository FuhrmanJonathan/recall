"use client";
import Link from "next/link";
import { RequireAuth, useAuth } from "@/components/auth";
import { Card, btnPrimary } from "@/components/ui";

// Placeholder numbers until the dashboard reads real decks and reviews.
const stats = [
  { label: "Cards due today", value: 0 },
  { label: "Decks", value: 0 },
  { label: "Day streak", value: 0 },
];

function Dashboard() {
  const { user } = useAuth();

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Signed in as {user?.email}</p>
        </div>
        <Link href="/cards" className={btnPrimary}>Start studying</Link>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-4 sm:p-5">
            <p className="text-xs text-gray-500 sm:text-sm">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold">{stat.value}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="font-semibold">Your decks</h2>
          <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm font-medium">Your study library</p>
            <p className="mt-1 text-sm text-gray-500">Find your saved decks or upload notes to your library.</p>
            <Link href="/decks" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
              Browse your decks
            </Link>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold">Up next</h2>
          <p className="mt-4 text-sm text-gray-500">Nothing due right now.</p>
          <Link href="/schedule" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
            View schedule
          </Link>
        </Card>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}
