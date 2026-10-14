"use client";
import Link from "next/link";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary } from "@/components/ui";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function SchedulePage() {
  return (
    <RequireAuth>
      <section>
        <h1 className="text-2xl font-bold tracking-tight">Schedule</h1>
        <p className="mt-1 text-sm text-gray-500">Cards due over the next week.</p>

        <Card className="mt-6 grid grid-cols-7 divide-x divide-gray-100 overflow-hidden">
          {days.map((day) => (
            <div key={day} className="p-3 text-center">
              <p className="text-xs text-gray-500">{day}</p>
              <p className="mt-1 text-lg font-semibold text-gray-300">0</p>
            </div>
          ))}
        </Card>

        <Card className="mt-4 p-8 text-center">
          <p className="font-medium">Nothing scheduled yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Your study plan will show up here once you have cards to review.
          </p>
          <Link href="/cards" className={`mt-5 ${btnPrimary}`}>Study cards</Link>
        </Card>
      </section>
    </RequireAuth>
  );
}
