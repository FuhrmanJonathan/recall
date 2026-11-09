"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";
import type { QuizRun } from "@/lib/quiz-session";

export default function QuizResults({ run }: { run: QuizRun }) {
  const router = useRouter();
  const [missedOnly, setMissedOnly] = useState(false);
  if (!run.summary || !run.attempts) return <p>This quiz has not been completed yet.</p>;
  const missed = run.summary.incorrect + run.summary.unanswered;
  return <>
    <Card className="mt-6 p-6">
      <h2 className="text-2xl font-semibold">{run.mode === "missed" ? "Missed-question practice" : "Quiz results"}</h2>
      <p className="mt-2 text-sm text-gray-600">{new Date(run.completed_at!).toLocaleString()} · {run.question_count} questions</p>
      <p className="mt-4 text-3xl font-semibold">{run.summary.accuracy}% accuracy</p>
      <div className="mt-5 grid grid-cols-3 gap-3 text-center">
        {(["correct", "incorrect", "unanswered"] as const).map(key => <div key={key} className="rounded-lg bg-gray-50 p-3"><p className="text-2xl font-semibold">{run.summary![key]}</p><p className="capitalize">{key}</p></div>)}
      </div>
      <p className="mt-4 text-sm text-gray-600">Accuracy includes self-marked answers. Revealing an answer without answering counts as unanswered. Your SM-2 schedule is unchanged.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        {missed > 0 && <button className={btnPrimary} onClick={() => router.push(`/quiz?retry=${run.id}&attempt=${crypto.randomUUID()}`)}>Retry missed questions ({missed})</button>}
        <button className={btnSecondary} onClick={() => router.push(`/quiz?repeat=${run.id}&attempt=${crypto.randomUUID()}`)}>Practice all again</button>
        {run.parent_id && <Link className={btnSecondary} href={`/quiz/history/${run.parent_id}`}>View previous attempt</Link>}
      </div>
      {run.parent_id && <p className="mt-3 text-sm text-gray-600">This is a separate attempt. Your previous score has not changed.</p>}
      {missed === 0 && <p className="mt-4 text-green-800">No missed questions in this attempt.</p>}
    </Card>
    <div className="mt-8 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Answer review</h2><label className="flex items-center gap-2"><input type="checkbox" checked={missedOnly} onChange={e => setMissedOnly(e.target.checked)} />Only missed questions</label></div>
    <p className="mt-2 text-sm text-gray-600">These are the questions as they appeared in this attempt, even if the source cards change later.</p>
    <div className="mt-4 space-y-4">{run.exercises.map((q, i) => {
      const a = run.attempts![i];
      if (missedOnly && a.result === "correct") return null;
      return <Card key={i} className="p-6">
        <p className={`font-semibold ${a.result === "correct" ? "text-green-800" : a.result === "incorrect" ? "text-red-700" : "text-amber-800"}`}>Question {i + 1} · {a.result}{a.markedCorrect && a.result === "correct" ? " (self-marked)" : ""}</p>
        <p className="mt-3 whitespace-pre-wrap break-words font-medium">{q.context}</p>
        <p className="mt-2 whitespace-pre-wrap break-words">{q.before}<strong>________</strong>{q.after}</p>
        <p className="mt-4 whitespace-pre-wrap break-words">Your answer: {a.text.trim() || "No answer"}</p>
        <p className="mt-2 whitespace-pre-wrap break-words">Correct answer: <strong>{q.answer}</strong></p>
      </Card>;
    })}</div>
    {missedOnly && missed === 0 && <p className="mt-4">Nothing to review here.</p>}
  </>;
}
