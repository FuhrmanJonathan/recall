"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RequireAuth, useAuth } from "@/components/auth";
import { useLeaveGuard } from "@/components/use-leave-guard";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

type Settings = { reminder_type: "none" | "daily" | "scheduled"; reminder_time: string; timezone: string; scheduled_days: string[] };
const field = "mt-2 block w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base";
const weekdays = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
const normalize = (settings: Settings): Settings => ({ ...settings, reminder_time: settings.reminder_time.slice(0, 5) });

function Reminders() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const dirty = !!settings && JSON.stringify(settings) !== saved;
  useLeaveGuard(dirty, saving);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    async function load() {
      try {
        const response = await fetch("/api/reminders", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not load your reminders. Your saved preferences have not changed.");
        const next = normalize(await response.json());
        if (!controller.signal.aborted) { setSettings(next); setSaved(JSON.stringify(next)); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load reminders."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  function change(changes: Partial<Settings>) {
    if (!settings || saving) return;
    setSettings({ ...settings, ...changes }); setMessage(""); setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings || lock.current) return;
    lock.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/reminders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not save reminders. Your changes are still here; please try again.");
      const next = normalize(body); setSettings(next); setSaved(JSON.stringify(next)); setMessage("Reminder preferences saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save reminders."); }
    finally { lock.current = false; setSaving(false); }
  }

  return <section className="mx-auto max-w-2xl"><h1 className="text-4xl font-semibold tracking-tight">Reminders</h1>
    <p className="mt-3 text-base text-gray-600">Choose when to receive a study reminder by email{user?.email ? ` at ${user.email}` : ""}.</p>
    {loading ? <p role="status" className="mt-8 text-gray-600">Loading your preferences…</p> : !settings ? <Card className="mt-6 p-6"><p role="alert" className="text-red-800">{error}</p><button onClick={() => setRevision((value) => value + 1)} className={`mt-4 ${btnSecondary}`}>Try again</button></Card> : <Card className="mt-7 p-6 sm:p-8">
      <form onSubmit={save} className="space-y-6"><fieldset disabled={saving} className="space-y-6">
        <label className="block text-sm font-semibold" htmlFor="reminder-frequency">Frequency<select id="reminder-frequency" value={settings.reminder_type} onChange={(e) => change({ reminder_type: e.target.value as Settings["reminder_type"], scheduled_days: [] })} className={field}><option value="none">Don’t send reminders</option><option value="daily">Every day</option><option value="scheduled">Choose days</option></select></label>
        {settings.reminder_type === "scheduled" && <div><p className="text-sm font-semibold">Days</p><div className="mt-3 flex flex-wrap gap-2">{weekdays.map(([value, label]) => <button key={value} type="button" aria-pressed={settings.scheduled_days.includes(value)} onClick={() => change({ scheduled_days: settings.scheduled_days.includes(value) ? settings.scheduled_days.filter((day) => day !== value) : [...settings.scheduled_days, value] })} className={settings.scheduled_days.includes(value) ? btnPrimary : btnSecondary}>{label}</button>)}</div>{!settings.scheduled_days.length && <p className="mt-2 text-sm text-gray-600">Choose at least one day.</p>}</div>}
        {settings.reminder_type !== "none" && <div className="grid gap-5 sm:grid-cols-2"><label className="text-sm font-semibold" htmlFor="reminder-time">Time<input id="reminder-time" type="time" required value={settings.reminder_time} onChange={(e) => change({ reminder_time: e.target.value })} className={field} /></label><label className="text-sm font-semibold" htmlFor="reminder-zone">Time zone<select id="reminder-zone" value={settings.timezone} onChange={(e) => change({ timezone: e.target.value })} className={field}>{!["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"].includes(settings.timezone) && <option value={settings.timezone}>{settings.timezone}</option>}<option value="America/New_York">Eastern</option><option value="America/Chicago">Central</option><option value="America/Denver">Mountain</option><option value="America/Los_Angeles">Pacific</option></select></label></div>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap items-center gap-4"><button disabled={saving || !dirty || (settings.reminder_type === "scheduled" && !settings.scheduled_days.length)} className={btnPrimary}>{saving ? "Saving…" : "Save reminders"}</button><p role="status" className="text-sm text-gray-600">{message || (dirty ? "Unsaved changes" : "Preferences up to date")}</p></div>
      </form>
    </Card>}
  </section>;
}

export default function SchedulePage() { return <RequireAuth><Reminders /></RequireAuth>; }
