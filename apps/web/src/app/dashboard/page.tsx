"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

function getColor(count: number): string {
  if (count === 0) return "#e5e7eb";
  if (count <= 10) return "#C4D9E8";
  if (count <= 25) return "#8FB8D4";
  if (count <= 50) return "#4682B4";
  return "#254F75";
}
type Activity = {
  date: string;
  cards_reviewed: number;
};

function HeatMap() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadActivity() {
      try {
        const response = await fetch("/api/activity", {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error("Failed to load activity");
        }

        const data: Activity[] = await response.json();
        setActivities(data);
      } catch {
        setError("Could not load study activity.");
      }
    }

    loadActivity();
}, []);
  const [month, setMonth] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  const today = new Date();
  const daysInMonth = new Date(
    month.getFullYear(), month.getMonth() + 1, 0
  ).getDate();

  const firstDay = month.getDay();
  function changeMonth(amount: number) {
    setMonth(new Date(
      month.getFullYear(),
      month.getMonth() + amount,
      1
    ));
  }
  return (
   <Card className="mt-6 p-5">
    <h2 className="font-semibold">Study activity</h2>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      <div style={{ display: "flex", gap: "20px", margin: "20px 0" }}>
        <button aria-label="Previous month" onClick={() => changeMonth(-1)}>←</button>

        <strong>
          {month.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric"
          })}
        </strong>

        <button
          aria-label="Next month"
          onClick={() => changeMonth(1)}
          disabled={
            month.getFullYear() === today.getFullYear() &&
            month.getMonth() === today.getMonth()
          }
        >
          →
        </button>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
        maxWidth: "420px",
        gap: "5px"
      }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
          <div key={day} style={{ textAlign: "center" }}>
            {day}
          </div>
        ))}

        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`empty-${i}`} />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => {
        const date = [
          month.getFullYear(),
          String(month.getMonth() + 1).padStart(2, "0"),
          String(i + 1).padStart(2, "0"),
        ].join("-");

        const count =
          activities.find((activity) => activity.date === date)
            ?.cards_reviewed ?? 0;

          return (
            <div
              key={i}
              title={`${count} cards reviewed`}
              style={{
                width: "100%",
                aspectRatio: "1",
                backgroundColor: getColor(count),
                borderRadius: "5px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: count > 25 ? "white" : "#17324D"
              }}
            >
              {i + 1}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

type DeckSummary = { id: number; title: string; card_count: number };

function Dashboard() {
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [due, setDue] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    async function load() {
      try {
        const [deckRes, queueRes] = await Promise.all([
          fetch("/api/decks", { signal: controller.signal, cache: "no-store" }),
          fetch("/api/study/cards?limit=1", { signal: controller.signal, cache: "no-store" }),
        ]);
        if (!deckRes.ok || !queueRes.ok) throw new Error("Could not load your study overview.");
        const [nextDecks, queue] = await Promise.all([deckRes.json(), queueRes.json()]);
        if (!controller.signal.aborted) { setDecks(nextDecks); setDue(queue.total); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load overview."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [revision]);
  const stats = [
    { label: "Your decks", value: decks.length },
    { label: "Saved flashcards", value: decks.reduce((sum, deck) => sum + deck.card_count, 0) },
    { label: "Ready to review", value: due ?? 0 },
  ];
  return <section>
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div><h1 className="mt-2 text-4xl font-semibold tracking-tight">Dashboard</h1></div>
      <Link href="/cards" className={btnPrimary}>Start studying →</Link>
    </div>
    {error && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}<button onClick={() => setRevision((value) => value + 1)} className={`ml-4 ${btnSecondary}`}>Try again</button></div>}
    <div className="mt-8 grid gap-4 sm:grid-cols-3">{stats.map((stat) => <Card key={stat.label} className="p-6"><p className="text-sm font-medium text-gray-600">{stat.label}</p><p className="mt-3 text-4xl font-semibold tracking-tight">{loading || error ? "—" : stat.value}</p></Card>)}</div>
    <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
      <Card className="p-6 sm:p-7"><div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Your decks</h2><Link href="/decks" className="text-sm font-semibold text-accent">View all →</Link></div>
        {loading ? <p role="status" className="py-8 text-gray-600">Loading your decks…</p> : decks.length ? <div className="divide-y divide-gray-100">{decks.slice(0, 5).map((deck) => <Link key={deck.id} href={`/decks/${deck.id}`} className="group flex items-center justify-between gap-4 py-5"><div className="min-w-0"><h3 className="break-words text-lg font-semibold group-hover:text-accent">{deck.title}</h3><p className="mt-1 text-sm text-gray-600">{deck.card_count} flashcards</p></div><span aria-hidden="true" className="text-accent">↗</span></Link>)}</div> : !error && <div className="rounded-xl bg-gray-50 p-6"><h3 className="text-lg font-semibold">Your next subject starts here.</h3><p className="mt-2 text-base text-gray-600">Create a deck and add your first cards.</p><Link href="/decks" className={`mt-5 ${btnPrimary}`}>Create a deck</Link></div>}
        <div className="mt-6 border-t border-gray-100 pt-5"><Link href="/schedule" className="text-sm font-semibold text-gray-700 hover:text-accent">Manage study reminders →</Link></div>
      </Card>
      <div className="[&>div]:mt-0"><HeatMap /></div>
    </div>
  </section>;
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}
