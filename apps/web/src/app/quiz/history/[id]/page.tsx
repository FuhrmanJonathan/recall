"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RequireAuth, useAuth } from "@/components/auth";
import { btnSecondary } from "@/components/ui";
import QuizResults from "@/components/quiz-results";
import { quizRequest, type QuizRun } from "@/lib/quiz-session";

function Detail({ id }: { id: string }) {
  const [run, setRun] = useState<QuizRun | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    quizRequest<QuizRun>(`/api/quiz/runs/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) setRun(body); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load quiz."); });
    return () => controller.abort();
  }, [id, retry]);
  return <section className="mx-auto max-w-3xl">
    <Link href="/quiz/history" className={btnSecondary}>← Quiz history</Link>
    <h1 className="mt-7 text-3xl font-semibold">Quiz answer review</h1>
    {error ? <><p role="alert" className="mt-6 text-red-700">{error}</p><button className={`mt-4 ${btnSecondary}`} onClick={() => setRetry(n => n + 1)}>Try again</button></>
      : !run ? <p role="status" className="mt-6">Loading answers…</p>
      : !run.completed_at ? <p className="mt-6">This quiz has not been completed. Return to the quiz tab to finish and save it.</p>
      : <QuizResults run={run} />}
  </section>;
}
function AccountDetail() { const { id } = useParams<{ id: string }>(); const { user } = useAuth(); return <Detail key={`${user!.id}:${id}`} id={id} />; }
export default function DetailPage() { return <RequireAuth><AccountDetail /></RequireAuth>; }
