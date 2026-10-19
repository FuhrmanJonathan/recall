
"use client";

import Link from "next/link";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary } from "@/components/ui";
import { useEffect, useState } from "react";
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function SchedulePage() {
  const [reminderType, setReminderType] = useState<
    "none" | "daily" | "scheduled"
  >("none");

  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  const [reminderTime, setReminderTime] = useState("18:00");
  const [timezone, setTimezone] = useState("America/New_York");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadReminders() {
      try {
        const response = await fetch("/api/reminders", {
          credentials: "include",
        });

        if (response.status === 401) {
        return; // Not logged in yet
      }

      if (!response.ok) {
        throw new Error(`Failed to load: ${response.status}`);
      }

        const data = await response.json();

        setReminderType(data.reminder_type);
        setReminderTime(data.reminder_time.slice(0, 5));
        setTimezone(data.timezone);
        setSelectedDays(data.scheduled_days);
      } catch (error) {
        console.error("Failed to load reminders:", error);
      }
    }

    loadReminders();
  }, []);

  function toggleDay(day: string) {
    setSelectedDays((previous) =>
      previous.includes(day)
        ? previous.filter((d) => d !== day)
        : [...previous, day]
    );
  }

  async function saveReminders() {
    setSaving(true);
    setSaveMessage("");
    setSaveError(false);

    try {
      const response = await fetch("/api/reminders", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reminder_type: reminderType,
          reminder_time: reminderTime,
          timezone: timezone,
          scheduled_days:
            reminderType === "scheduled" ? selectedDays : [],
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save: ${response.status}`);
      }

      setSaveMessage("Preferences saved successfully!");
    } catch (error) {
      console.error(error);
      setSaveError(true);
      setSaveMessage("Could not save preferences.");
    } finally {
      setSaving(false);
    }
  }

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

        <Card className="mt-6 p-6">
          <h2 className="text-lg font-semibold">
            Reminders
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            When should Recall remind you to study?
          </p>

          <select
            className="mt-4 w-full rounded-lg border p-2"
            value={reminderType}
            onChange={(e) =>
              setReminderType(
                e.target.value as "none" | "daily" | "scheduled"
              )
            }
          >
            <option value="none">Never</option>
            <option value="daily">Every day</option>
            <option value="scheduled">Schedule</option>
          </select>

          {reminderType === "scheduled" && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">
                Select reminder days
              </p>

              <div className="flex flex-wrap gap-2">
                {[
                  ["mon", "Mon"],
                  ["tue", "Tue"],
                  ["wed", "Wed"],
                  ["thu", "Thu"],
                  ["fri", "Fri"],
                  ["sat", "Sat"],
                  ["sun", "Sun"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleDay(value)}
                    className={`rounded-lg border px-4 py-2 ${
                      selectedDays.includes(value)
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {reminderType !== "none" && (
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium">
                  Reminder time
                </label>

                <input
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="mt-2 rounded-lg border p-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium">
                  Time zone
                </label>

                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="mt-2 w-full rounded-lg border p-2"
                >
                  <option value="America/New_York">Eastern</option>
                  <option value="America/Chicago">Central</option>
                  <option value="America/Denver">Mountain</option>
                  <option value="America/Los_Angeles">Pacific</option>
                </select>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={saveReminders}
            disabled={
              saving ||
              (reminderType === "scheduled" && selectedDays.length === 0)
            }
            className="mt-5 rounded-lg bg-blue-600 px-5 py-2 text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Preferences"}
          </button>

          {saveMessage && (
            <p
              role="status"
              className={`mt-3 text-sm ${
                saveError ? "text-red-600" : "text-green-600"
              }`}
            >
              {saveMessage}
            </p>
          )}
        </Card>
      </section>
    </RequireAuth>
  );
}
