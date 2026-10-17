"use client";
import { useState } from "react";
import Link from "next/link";
import { RequireAuth, useAuth } from "@/components/auth";
import { Card, btnPrimary } from "@/components/ui";

// Placeholder numbers until the dashboard reads real decks and reviews.
const stats = [
  { label: "Cards due today", value: 0 },
  { label: "Decks", value: 0 },
  { label: "Day streak", value: 0 },
];


// Temporary sample data until we connect the backend
const sampleCounts = [
  0, 5, 12, 30, 50, 0, 8,
  15, 25, 40, 0, 10, 20, 55,
  0, 3, 18, 35, 60, 12, 0,
  7, 22, 45, 10, 0, 30, 50,
];

function getColor(count: number): string {
  if (count === 0) return "#e5e7eb";
  if (count <= 10) return "#C4D9E8";
  if (count <= 25) return "#8FB8D4";
  if (count <= 50) return "#4682B4";
  return "#254F75";
}

function HeatMap() {
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
    <main style={{ padding: "30px" }}>
      <h2>Dashboard</h2>
      <h3 style={{ marginTop: "30px" }}>Study Activity</h3>

      <div style={{ display: "flex", gap: "20px", margin: "20px 0" }}>
        <button onClick={() => changeMonth(-1)}>←</button>

        <strong>
          {month.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric"
          })}
        </strong>

        <button
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
        gridTemplateColumns: "repeat(7, 40px)",
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
          const count = sampleCounts[
            (i + month.getMonth()) % sampleCounts.length
          ];

          return (
            <div
              key={i}
              title={`${count} cards reviewed`}
              style={{
                width: "40px",
                height: "40px",
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
    </main>
  );
}

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
            <p className="text-sm font-medium">No decks yet</p>
            <p className="mt-1 text-sm text-gray-500">Decks made from your notes will show up here.</p>
            <Link href="/cards" className="mt-4 inline-block text-sm font-medium text-accent hover:underline">
              Try the sample deck
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
      <HeatMap/>
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
