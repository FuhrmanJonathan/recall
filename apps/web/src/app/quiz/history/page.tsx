"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireAuth, useAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";
import { quizRequest, type QuizRun } from "@/lib/quiz-session";

type History = { items: QuizRun[]; total: number };
function HistoryList() {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    quizRequest<History>(`/api/quiz/history?offset=${offset}&limit=20`, { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) setData(body); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load history."); });
    return () => controller.abort();
  }, [offset, retry]);
  return <section className="mx-auto max-w-3xl">
    <Link href="/cards" className={btnSecondary}>← Back to cards</Link>
    <h1 className="mt-7 text-3xl font-semibold">Quiz history & mistakes</h1>
    <p className="mt-3 text-gray-600">Open a completed quiz to review your answers or practice its missed questions. Each attempt keeps its own score.</p>
    {error ? <Card className="mt-6 p-6"><p role="alert" className="text-red-700">{error}</p><button onClick={() => setRetry(n => n + 1)} className={`mt-4 ${btnSecondary}`}>Try again</button></Card>
      : !data ? <p role="status" className="mt-6">Loading history…</p>
      : <>
        {data.total === 0 ? <Card className="mt-6 p-6"><p>No completed quizzes yet. Finish a quiz to save your results here.</p><Link href="/cards" className={`mt-4 ${btnPrimary}`}>Choose cards</Link></Card>
          : <p className="mt-6 text-sm text-gray-600">{data.total} completed attempts</p>}
        <div className="mt-4 space-y-4">{data.items.map(run => <Card key={run.id} className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">{run.mode === "missed" ? "Missed-question practice" : run.mode === "repeat" ? "Repeat practice" : "Card quiz"}</h2><p className="mt-2 text-sm text-gray-600">{new Date(run.completed_at!).toLocaleString()} · {run.question_count} questions</p></div><p className="text-2xl font-semibold">{run.summary!.accuracy}%</p></div>
          <p className="mt-3">{run.summary!.correct} correct · {run.summary!.incorrect} incorrect · {run.summary!.unanswered} unanswered</p>
          <Link href={`/quiz/history/${run.id}`} className={`mt-4 ${btnSecondary}`}>Review answers & mistakes</Link>
        </Card>)}</div>
        {data.total > 20 && <div className="mt-6 flex gap-3"><button disabled={offset === 0} className={btnSecondary} onClick={() => setOffset(n => Math.max(0, n - 20))}>Previous</button><button disabled={offset + data.items.length >= data.total} className={btnSecondary} onClick={() => setOffset(n => n + 20)}>Next</button></div>}
      </>}
  </section>;
}
function AccountHistory() { const { user } = useAuth(); return <HistoryList key={user!.id} />; }
export default function HistoryPage() { return <RequireAuth><AccountHistory /></RequireAuth>; }
