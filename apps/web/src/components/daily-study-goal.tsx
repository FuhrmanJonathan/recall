"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Yogo from "@/components/yogo";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

type Goal = { target: number; reviewed: number; timezone: string; date: string; next_reset_at: string };

async function readGoal(response: Response): Promise<Goal> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not update your daily goal. Please try again.");
  return body;
}

export default function DailyStudyGoal() {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [message, setMessage] = useState("");
  const [target, setTarget] = useState("20");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const request = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible" && !lock.current) setRevision(n => n + 1); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (lock.current) return;
    const controller = new AbortController();
    const current = ++request.current;
    const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    async function load() {
      try {
        const next = await readGoal(await fetch(`/api/goals/daily?timezone=${encodeURIComponent(localZone)}`, { signal: controller.signal, cache: "no-store" }));
        if (!controller.signal.aborted && current === request.current) { setGoal(next); setError(""); }
      } catch {
        if (!controller.signal.aborted && current === request.current) setError("Could not refresh your daily goal. Progress may be out of date.");
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!goal) return;
    const delay = new Date(goal.next_reset_at).getTime() - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(() => setRevision(n => n + 1), delay + 100);
    return () => window.clearTimeout(timer);
  }, [goal]);

  function edit() {
    if (!goal) return;
    setTarget(String(goal.target));
    setSaveError(""); setMessage(""); dialog.current?.showModal();
    requestAnimationFrame(() => { targetInput.current?.focus(); targetInput.current?.select(); });
  }

  async function save() {
    if (lock.current) return;
    const value = Number(target);
    if (!Number.isInteger(value) || value < 1 || value > 1000) { setSaveError("Choose a whole number from 1 to 1,000."); return; }
    lock.current = true; ++request.current; setSaving(true); setSaveError("");
    try {
      const next = await readGoal(await fetch("/api/goals/daily", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      }));
      setGoal(next); setError(""); dialog.current?.close(); setMessage("Daily goal saved.");
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Your goal was not saved. Please try again."); }
    finally { lock.current = false; setSaving(false); }
  }

  if (!goal) return <Card className="mt-6 p-6 sm:p-7">
    <h2 className="text-xl font-semibold">Daily study goal</h2>
    {error ? <><p role="alert" className="mt-3 text-red-700">{error}</p><button onClick={() => setRevision(n => n + 1)} className={`mt-4 ${btnSecondary}`}>Try again</button></> : <p role="status" className="mt-3 text-gray-600">Loading today’s progress…</p>}
  </Card>;

  const complete = goal.reviewed >= goal.target;
  const remaining = Math.max(0, goal.target - goal.reviewed);
  const percent = Math.min(100, Math.round(goal.reviewed / goal.target * 100));
  return <Card className={`mt-6 overflow-hidden p-6 sm:p-7 ${complete ? "border-green-200 bg-green-50/40" : ""}`}>
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-gray-600">A little progress, every day</p><h2 className="mt-1 text-xl font-semibold">Daily study goal</h2></div>
      <button onClick={edit} aria-haspopup="dialog" className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-accent hover:bg-blue-50">Edit goal</button>
    </div>
    <div className="mt-4 flex items-center gap-4 sm:gap-7">
      <Yogo key={`${goal.date}-${complete}`} expression={complete ? "celebrating" : "encouraging"} size={100} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-3xl font-semibold tracking-tight sm:text-4xl">{goal.reviewed}<span className="text-xl font-medium text-gray-500"> / {goal.target}</span></p>
        <p className="mt-1 text-sm text-gray-600">cards reviewed today</p>
        <div role="progressbar" aria-label="Daily review goal" aria-valuemin={0} aria-valuemax={goal.target} aria-valuenow={Math.min(goal.reviewed, goal.target)} aria-valuetext={`${goal.reviewed} of ${goal.target} cards reviewed`} className="mt-4 h-2.5 overflow-hidden rounded-full bg-gray-200">
          <div className={`h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${complete ? "bg-green-600" : "bg-accent"}`} style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
    <p role="status" className={`mt-3 font-medium ${complete ? "text-green-800" : "text-ink"}`}>{complete ? "Goal reached! Yogo’s cheering you on." : goal.reviewed ? `${remaining} more ${remaining === 1 ? "card" : "cards"} to reach your goal. You’ve got this.` : "Small steps add up. Start with your first card."}</p>
    <div className="mt-5 flex flex-wrap items-center gap-4">
      <Link href="/cards" className={complete ? btnSecondary : btnPrimary}>{complete ? "Keep studying →" : "Review cards →"}</Link>
      {complete && <span className="text-sm font-medium text-green-800">Today’s goal complete ✓</span>}
    </div>
    {error && <div className="mt-4 flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-red-700">{error}</p><button className="text-sm font-semibold text-accent underline" onClick={() => setRevision(n => n + 1)}>Retry</button></div>}
    {message && <p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
    <dialog ref={dialog} aria-labelledby="goal-dialog-title" aria-describedby="goal-dialog-description"
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl border border-gray-200 bg-white p-0 text-ink shadow-2xl backdrop:bg-gray-950/35"
      onCancel={e => { if (lock.current) e.preventDefault(); }}
      onClick={e => { if (e.target === e.currentTarget && !lock.current) dialog.current?.close(); }}>
      <form className="p-6" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="flex items-start justify-between gap-4">
          <h2 id="goal-dialog-title" className="text-xl font-semibold tracking-tight">Daily study goal</h2>
          <button type="button" aria-label="Close goal settings" disabled={saving} onClick={() => dialog.current?.close()} className="-mr-2 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 active:scale-[0.97] disabled:opacity-50">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <p id="goal-dialog-description" className="mt-2 text-sm text-gray-600">How many cards would you like to review each day?</p>
        <fieldset disabled={saving} className="mt-6 min-w-0">
          <label htmlFor="daily-target" className="block text-sm font-medium">Cards per day</label>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" aria-label="Decrease daily goal" disabled={Number(target) <= 1} onClick={() => setTarget(String(Math.max(1, (Number(target) || 1) - 1)))} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-2xl hover:bg-gray-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40">−</button>
            <input ref={targetInput} id="daily-target" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} required value={target}
              onFocus={e => e.currentTarget.select()} onChange={e => { if (/^\d{0,4}$/.test(e.target.value)) { setTarget(e.target.value); setSaveError(""); } }}
              className="h-14 min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 text-center text-3xl font-semibold tabular-nums" />
            <button type="button" aria-label="Increase daily goal" disabled={Number(target) >= 1000} onClick={() => setTarget(String(Math.min(1000, (Number(target) || 0) + 1)))} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-gray-200 text-2xl hover:bg-gray-50 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40">+</button>
          </div>
          {saveError && <p role="alert" className="mt-3 text-sm text-red-700">{saveError}</p>}
          <div className="mt-7 grid grid-cols-2 gap-3">
            <button type="button" className={btnSecondary} onClick={() => dialog.current?.close()}>Cancel</button>
            <button className={btnPrimary}>{saving ? "Saving…" : "Save goal"}</button>
          </div>
        </fieldset>
      </form>
    </dialog>
  </Card>;
}
