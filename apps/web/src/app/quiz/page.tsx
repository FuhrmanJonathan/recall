"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { RequireAuth, useAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";
import QuizResults from "@/components/quiz-results";
import { quizResult, type QuizAttempt } from "@/lib/quiz-scoring";
import { advanceProgress, completionBody, quizRequest, restoreProgress, type Progress, type QuizRun } from "@/lib/quiz-session";

function Quiz({ query, userId }: { query: string; userId: number }) {
  const [run, setRun] = useState<QuizRun | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [saveRetry, setSaveRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const requestId = useRef("");
  const answerRef = useRef<HTMLInputElement>(null);
  const storageKey = `recall:quiz:v3:${userId}:${query}`;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setError("");
      const params = new URLSearchParams(query);
      const parent = params.get("retry") || params.get("repeat");
      const mode = params.has("retry") ? "missed" : params.has("repeat") ? "repeat" : "cards";
      const raw = params.get("cards") || "";
      const ids = [...new Set(raw.split(",").map(Number))];
      if ((mode === "cards" && (!raw || ids.length > 100 || ids.some(i => !Number.isSafeInteger(i) || i <= 0)))
        || (mode !== "cards" && (!parent || !/^[0-9a-f-]{36}$/i.test(parent)))
        || (parent && raw) || (params.has("retry") && params.has("repeat"))) {
        setError("Select up to 100 cards, or choose a completed quiz from your history."); return;
      }
      try {
        let saved: unknown = null;
        try {
          saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
          if (!requestId.current) requestId.current = sessionStorage.getItem(storageKey + ":request") || crypto.randomUUID();
          sessionStorage.setItem(storageKey + ":request", requestId.current);
        } catch { setStorageWarning(true); }
        if (!requestId.current) requestId.current = crypto.randomUUID();
        const runId = saved && typeof saved === "object" && "runId" in saved && typeof saved.runId === "string" ? saved.runId : null;
        const current = runId
          ? await quizRequest<QuizRun>(`/api/quiz/runs/${encodeURIComponent(runId)}`, { signal: controller.signal })
          : await quizRequest<QuizRun>("/api/quiz/runs", { method: "POST", signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ request_id: requestId.current, mode, ...(mode === "cards" ? { card_ids: ids } : { parent_id: parent }) }) });
        if (!controller.signal.aborted) { setRun(current); setProgress(restoreProgress(current, saved)); }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not open quiz.");
      }
    }
    void load();
    return () => controller.abort();
  }, [query, retry, storageKey]);

  useEffect(() => {
    if (!progress) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(progress)); }
    catch { setStorageWarning(true); }
  }, [progress, storageKey]);
  useEffect(() => { answerRef.current?.focus(); }, [progress?.index, !!progress]);

  // A retry resends the same run ID and answers, so a lost response cannot duplicate history.
  useEffect(() => {
    if (!run || run.completed_at || !progress || progress.index !== run.exercises.length) return;
    let active = true;
    setSaving(true); setSaveError("");
    quizRequest<QuizRun>(`/api/quiz/runs/${run.id}/complete`, { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(completionBody(progress.attempts)) })
      .then(saved => { if (active) setRun(saved); })
      .catch(e => { if (active) setSaveError(e instanceof Error ? e.message : "Could not save your results."); })
      .finally(() => { if (active) setSaving(false); });
    return () => { active = false; };
  }, [run, progress, saveRetry]);

  function updateAttempt(change: Partial<QuizAttempt>) {
    setProgress(p => p ? { ...p, attempts: p.attempts.map((a, i) => i === p.index ? { ...a, ...change } : a) } : p);
  }
  const q = run && progress ? run.exercises[progress.index] : null;
  const a = progress?.attempts[progress.index];
  const result = q && a ? quizResult(q.answer, a) : "unanswered";
  return <section className="mx-auto max-w-3xl">
    <div className="flex flex-wrap gap-3"><Link href="/cards" className={btnSecondary}>← Back to cards</Link><Link href="/quiz/history" className={btnSecondary}>Quiz history & mistakes</Link></div>
    <h1 className="mt-7 text-3xl font-semibold">{run?.mode === "missed" ? "Practice missed questions" : "Fill-in-the-blank quiz"}</h1>
    <p className="mt-3 text-gray-600">Practice with saved quiz questions. Completed results go into your history. Your SM-2 schedule stays unchanged.</p>
    {storageWarning && <p role="status" className="mt-3 text-amber-800">Browser storage is unavailable. Unfinished answers may be lost when you leave.</p>}
    {error ? <Card className="mt-6 p-6"><p role="alert" className="text-red-700">{error}</p><button className={`mt-4 ${btnSecondary}`} onClick={() => setRetry(n => n + 1)}>Try again</button></Card>
      : !run || !progress ? <p role="status" className="mt-8">Opening your quiz…</p>
      : run.completed_at ? <QuizResults run={run} />
      : q && a ? <Card className="mt-6 p-6 sm:p-8">
        <p className="text-sm text-gray-600">Question {progress.index + 1} of {run.exercises.length}</p>
        <p className="mt-4 whitespace-pre-wrap break-words font-medium">{q.context}</p>
        <p className="mt-5 whitespace-pre-wrap break-words text-xl leading-relaxed">{q.before}<span className="font-semibold text-accent" aria-label="blank">________</span>{q.after}</p>
        <form className="mt-6" onSubmit={e => { e.preventDefault(); if (a.text.trim() && !a.revealed) updateAttempt({ revealed: true }); }}>
          <label htmlFor="cloze-answer" className="block text-sm font-medium">Your answer</label>
          <input ref={answerRef} id="cloze-answer" autoComplete="off" maxLength={2000} disabled={a.revealed} value={a.text}
            aria-describedby="quiz-answer-help" onChange={e => updateAttempt({ text: e.target.value })} className="mt-2 w-full rounded-lg border border-gray-300 p-3" />
          <p id="quiz-answer-help" className="mt-2 text-sm text-gray-600">Type sigma for σ / Σ, alpha for α, mu for μ, or * for ×. Case and extra spaces are ignored.</p>
          {!a.revealed && <div className="mt-4 flex flex-wrap gap-3"><button disabled={!a.text.trim()} className={btnPrimary}>Check answer</button><button type="button" className={btnSecondary} onClick={() => updateAttempt({ revealed: true, text: "", markedCorrect: false })}>Show answer</button></div>}
        </form>
        {a.revealed && <div className="mt-5">
          <div role="status" className={`rounded-xl p-4 ${result === "correct" ? "bg-green-50 text-green-800" : result === "incorrect" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
            <p className="font-semibold">{result === "correct" ? "✓ Correct" : result === "incorrect" ? "✗ Incorrect" : "— Unanswered"}{a.markedCorrect && result === "correct" ? " (self-marked)" : ""}</p>
            <p className="mt-2 whitespace-pre-wrap break-words">Correct answer: {q.answer}</p>
          </div>
          {result === "incorrect" && <><p className="mt-3 text-sm text-gray-600">Equivalent wording or an unsupported symbol? Compare the answer and adjust your score if needed.</p><button className={`mt-3 ${btnSecondary}`} onClick={() => updateAttempt({ markedCorrect: true })}>Mark my answer correct</button></>}
          {a.markedCorrect && <button className={`mt-3 ${btnSecondary}`} onClick={() => updateAttempt({ markedCorrect: false })}>Undo self-mark</button>}
          <div><button className={`mt-5 ${btnPrimary}`} onClick={() => setProgress(p => advanceProgress(p, progress.index))}>{progress.index + 1 === run.exercises.length ? "Finish and save quiz" : "Next question →"}</button></div>
        </div>}
      </Card> : <Card className="mt-6 p-8">
        <h2 className="text-2xl font-semibold">{saving ? "Saving your results…" : "Results not saved yet"}</h2>
        {saveError && <p role="alert" className="mt-3 text-red-700">{saveError}</p>}
        <p className="mt-3">Your answers are still here. Results appear in history after saving succeeds.</p>
        {!saving && <div className="mt-4 flex flex-wrap gap-3"><button className={btnPrimary} onClick={() => setSaveRetry(n => n + 1)}>Retry saving</button><Link href={`/quiz/history/${run.id}`} className={btnSecondary}>Check saved results</Link></div>}
      </Card>}
  </section>;
}

function QuizWithParams() {
  const params = useSearchParams();
  const { user } = useAuth();
  const query = params.toString();
  return <Quiz key={`${user!.id}:${query}`} query={query} userId={user!.id} />;
}
export default function QuizPage() { return <RequireAuth><Suspense fallback={<p>Loading quiz…</p>}><QuizWithParams /></Suspense></RequireAuth>; }
