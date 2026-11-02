"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { RequireAuth, useAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";
import { quizResult, quizSummary, type QuizAttempt } from "@/lib/quiz-scoring";

type Exercise = { source_card_id: number; context: string; before: string; answer: string; after: string };
type Attempt = QuizAttempt;
type Snapshot = { version: 2; fingerprint: string; exercises: Exercise[]; attempts: Attempt[]; index: number };

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as Snapshot;
  return s.version === 2 && typeof s.fingerprint === "string" && Array.isArray(s.exercises) && s.exercises.length > 0 && s.exercises.length <= 100
    && s.exercises.every(e => e && Number.isInteger(e.source_card_id) && [e.context, e.before, e.answer, e.after].every(v => typeof v === "string") && e.answer.trim())
    && Array.isArray(s.attempts) && s.attempts.length === s.exercises.length
    && s.attempts.every(a => a && typeof a.text === "string" && typeof a.revealed === "boolean" && (a.markedCorrect === undefined || typeof a.markedCorrect === "boolean"))
    && Number.isInteger(s.index) && s.index >= 0 && s.index <= s.exercises.length;
}

function Quiz() {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [storageKey, setStorageKey] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [confirmationCount, setConfirmationCount] = useState(0);
  const [confirmedLarge, setConfirmedLarge] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const answerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setSnapshot(null); setError("");
      const raw = new URLSearchParams(window.location.search).get("cards") ?? "";
      const ids = [...new Set(raw.split(",").map(Number))];
      if (!raw || ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
        setError("Select cards from one Study page first (up to 100 per page)."); return;
      }
      const key = `recall:cloze:v2:${user?.id}:${ids.join(",")}`;
      setStorageKey(key);
      try {
        // Validate ownership and content without a paid AI call before restoring.
        const sourceRes = await fetch("/api/quiz/sources", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card_ids: ids }) });
        const source = await sourceRes.json().catch(() => ({}));
        if (!sourceRes.ok) throw new Error(typeof source.detail === "string" ? source.detail : "Could not check source cards.");
        try {
          const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
          if (validSnapshot(saved) && saved.fingerprint === source.fingerprint) {
            if (!controller.signal.aborted) setSnapshot(saved);
            return;
          }
        } catch { setStorageWarning(true); }
        if (controller.signal.aborted) return;
        if (ids.length > 20 && !confirmedLarge) { setConfirmationCount(ids.length); return; }
        setConfirmationCount(0);
        const res = await fetch("/api/quiz/cloze", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card_ids: ids, confirmed_large: confirmedLarge }) });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not create quiz. Please try again.");
        const fresh: Snapshot = { version: 2, fingerprint: body.fingerprint, exercises: body.exercises,
          attempts: Array.isArray(body.exercises) ? body.exercises.map(() => ({ text: "", revealed: false })) : [], index: 0 };
        if (!validSnapshot(fresh)) throw new Error("Quiz returned an invalid exercise. Please try again.");
        if (!controller.signal.aborted) setSnapshot(fresh);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not create quiz.");
      }
    }
    void load();
    return () => controller.abort();
  }, [user?.id, retry, confirmedLarge]);

  useEffect(() => {
    if (!snapshot || !storageKey) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(snapshot)); }
    catch { setStorageWarning(true); }
  }, [snapshot, storageKey]);
  useEffect(() => { answerRef.current?.focus(); }, [snapshot?.index, !!snapshot]);

  function updateAttempt(change: Partial<Attempt>) {
    setSnapshot(s => s ? { ...s, attempts: s.attempts.map((a, i) => i === s.index ? { ...a, ...change } : a) } : s);
  }
  const exercise = snapshot?.exercises[snapshot.index];
  const attempt = snapshot?.attempts[snapshot.index];
  const result = exercise && attempt ? quizResult(exercise.answer, attempt) : "unanswered";
  const summary = snapshot ? quizSummary(snapshot.exercises, snapshot.attempts) : null;
  return <section className="mx-auto max-w-2xl">
    <Link href="/cards" className={btnSecondary}>← Back to cards</Link>
    <h1 className="mt-7 text-3xl font-semibold">Fill-in-the-blank quiz</h1>
    <p className="mt-3 text-gray-600">AI selects key phrases from your cards for this quiz. Your SM-2 schedule stays unchanged. Refreshing or practicing again reuses the saved quiz when the source cards have not changed.</p>
    {storageWarning && <p role="status" className="mt-3 text-amber-800">Browser storage is unavailable. Progress may be lost when you leave.</p>}
    {error ? <Card className="mt-6 p-6"><p role="alert" className="text-red-700">{error}</p><button className={`mt-4 ${btnSecondary}`} onClick={() => setRetry(n => n + 1)}>Try again</button></Card>
      : !snapshot && confirmationCount > 20 && !confirmedLarge ? <Card className="mt-6 p-6"><h2 className="text-xl font-semibold">Create a {confirmationCount}-question quiz?</h2><p className="mt-3">This sends {confirmationCount} selected cards to OpenAI in one request (maximum 100 cards per quiz). It may take longer and use more API credits. Continue?</p><div className="mt-5 flex gap-3"><button className={btnPrimary} onClick={() => setConfirmedLarge(true)}>Confirm and generate</button><Link className={btnSecondary} href="/cards">Cancel</Link></div></Card>
      : !snapshot ? <p role="status" className="mt-8">Preparing your quiz… AI generation may take a moment.</p>
      : exercise && attempt ? <Card className="mt-6 p-6 sm:p-8">
        <p className="text-sm text-gray-600">Question {snapshot.index + 1} of {snapshot.exercises.length}</p>
        <p className="mt-4 whitespace-pre-wrap break-words font-medium">{exercise.context}</p>
        <p className="mt-5 whitespace-pre-wrap break-words text-xl leading-relaxed">{exercise.before}<span className="font-semibold text-accent" aria-label="blank">________</span>{exercise.after}</p>
        <form className="mt-6" onSubmit={e => { e.preventDefault(); if (attempt.text.trim() && !attempt.revealed) updateAttempt({ revealed: true }); }}>
          <label htmlFor="cloze-answer" className="block text-sm font-medium">Your answer</label>
          <input ref={answerRef} id="cloze-answer" autoComplete="off" maxLength={2000} disabled={attempt.revealed} value={attempt.text}
            aria-describedby="quiz-answer-help" onChange={e => updateAttempt({ text: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 p-3" />
          <p id="quiz-answer-help" className="mt-2 text-sm text-gray-600">You can type sigma for σ / Σ, alpha for α, mu for μ, * for ×, and &lt;= / &gt;= for ≤ / ≥. Case and extra spaces are ignored; other symbols still matter.</p>
          {!attempt.revealed && <div className="mt-4 flex flex-wrap gap-3"><button disabled={!attempt.text.trim()} className={`${btnPrimary} disabled:opacity-40`}>Check answer</button><button type="button" className={btnSecondary} onClick={() => updateAttempt({ revealed: true, text: "" })}>Show answer</button></div>}
        </form>
        {attempt.revealed && <div className="mt-5">
          <div role="status" className={`rounded-xl p-4 ${result === "correct" ? "bg-green-50 text-green-800" : result === "incorrect" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
            <p className="font-semibold">{result === "correct" ? "✓ Correct" : result === "incorrect" ? "✗ Incorrect" : "— Unanswered"}{attempt.markedCorrect && result === "correct" ? " (self-marked)" : ""}</p>
            <p className="mt-2 whitespace-pre-wrap break-words">Correct answer: {exercise.answer}</p>
          </div>
          {result === "incorrect" && <><p className="mt-3 text-sm text-gray-600">An equivalent wording or an unsupported symbol? Compare the answer, then adjust your score if needed.</p><button className={`mt-3 ${btnSecondary}`} onClick={() => updateAttempt({ markedCorrect: true })}>Mark my answer correct</button></>}
          {attempt.markedCorrect && <button className={`mt-3 ${btnSecondary}`} onClick={() => updateAttempt({ markedCorrect: false })}>Undo self-mark</button>}
          <div><button className={`mt-5 ${btnPrimary}`} onClick={() => setSnapshot(s => s ? { ...s, index: s.index + 1 } : s)}>{snapshot.index + 1 === snapshot.exercises.length ? "Finish quiz" : "Next question →"}</button></div>
        </div>}
      </Card> : <Card className="mt-6 p-8"><h2 className="text-2xl font-semibold">Quiz complete</h2>
        <p className="mt-4 text-3xl font-semibold">{summary?.accuracy}% accuracy</p>
        <div className="mt-5 grid grid-cols-3 gap-3 text-center"><div className="rounded-lg bg-green-50 p-3 text-green-800"><p className="text-2xl font-semibold">{summary?.correct}</p><p>Correct</p></div><div className="rounded-lg bg-red-50 p-3 text-red-800"><p className="text-2xl font-semibold">{summary?.incorrect}</p><p>Incorrect</p></div><div className="rounded-lg bg-amber-50 p-3 text-amber-900"><p className="text-2xl font-semibold">{summary?.unanswered}</p><p>Unanswered</p></div></div>
        <p className="mt-4 text-sm text-gray-600">Correct answers ÷ all {snapshot.exercises.length} questions. Includes self-marked answers. Revealed answers count as unanswered.</p>
        <p className="mt-2 text-gray-600">No cards or review records were changed.</p><button className={`mt-5 ${btnPrimary}`} onClick={() => setSnapshot({ ...snapshot, index: 0, attempts: snapshot.exercises.map(() => ({ text: "", revealed: false })) })}>Practice again</button></Card>}
  </section>;
}

export default function QuizPage() { return <RequireAuth><Quiz /></RequireAuth>; }
