"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RequireAuth, useAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";
import { useLeaveGuard } from "@/components/use-leave-guard";
import { quizRequest } from "@/lib/quiz-session";

type QuizQuestion = {card_id: number; card_question: string; card_answer: string; question: string; answer: string; version: number};
const blank = "________";
const field = "mt-2 w-full rounded-xl border border-gray-300 p-3";

function Editor({ id }: { id: string }) {
  const [saved, setSaved] = useState<QuizQuestion | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const dirty = !!saved && (question !== saved.question || answer !== saved.answer);
  useLeaveGuard(dirty, saving);

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    quizRequest<QuizQuestion>(`/api/quiz/cards/${encodeURIComponent(id)}/question`, {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted) {setSaved(data); setQuestion(data.question); setAnswer(data.answer);} })
      .catch(e => {if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load quiz.");});
    return () => controller.abort();
  }, [id, retry]);

  function insertBlank() {
    const field = questionRef.current;
    const start = field?.selectionStart ?? question.length;
    const end = field?.selectionEnd ?? start;
    const next = question.slice(0, start) + blank + question.slice(end);
    if (next.length > 5000) {setError("The question must be at most 5,000 characters."); return;}
    setQuestion(next); setMessage("");
    requestAnimationFrame(() => {field?.focus(); field?.setSelectionRange(start + blank.length, start + blank.length);});
  }
  async function save() {
    if (!saved || lock.current) return;
    if (!question.includes(blank) || !question.split(blank).join("").trim()) {setError("Write a question and use Insert blank to mark the missing answer."); return;}
    if (!answer.trim() || answer.includes(blank)) {setError("Enter the correct answer without a blank marker."); return;}
    lock.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const data = await quizRequest<QuizQuestion>(`/api/quiz/cards/${encodeURIComponent(id)}/question`, {
        method: "PUT", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({question, answer, version: saved.version})
      });
      setSaved(data); setQuestion(data.question); setAnswer(data.answer); setMessage("Quiz saved. Your card content has not changed.");
    } catch(e) {setError(e instanceof Error ? e.message : "Could not save quiz.");}
    finally {lock.current = false; setSaving(false);}
  }
  return <section className="mx-auto max-w-3xl">
    <Link href="/cards" className={btnSecondary}>← Back to cards</Link>
    <h1 className="mt-7 text-3xl font-semibold">Edit quiz</h1>
    <p className="mt-3 text-gray-600">Edit this card’s fill-in-the-blank question and correct answer. Your original card and past quiz results stay unchanged.</p>
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    {!saved ? error ? <button className={`mt-4 ${btnSecondary}`} onClick={() => setRetry(n => n + 1)}>Try again</button> : <p className="mt-6">Loading quiz…</p>
      : <>
        <details className="mt-6 rounded-xl border border-gray-200 p-4"><summary className="cursor-pointer font-medium">Original card (reference only)</summary><p className="mt-3 whitespace-pre-wrap break-words">{saved.card_question}</p><p className="mt-2 whitespace-pre-wrap break-words text-gray-600">{saved.card_answer}</p></details>
        <Card className="mt-6 p-6 sm:p-8"><form onSubmit={e => {e.preventDefault(); void save();}}>
          <div className="flex items-center justify-between gap-3"><label htmlFor="quiz-question" className="font-semibold">Quiz question</label><button type="button" disabled={saving} onClick={insertBlank} className={btnSecondary}>Insert blank</button></div>
          <textarea ref={questionRef} id="quiz-question" className={`${field} min-h-36`} value={question} maxLength={5000} disabled={saving} placeholder="The capital of France is ________." onChange={e => {setQuestion(e.target.value); setMessage("");}} aria-describedby="question-help" />
          <p id="question-help" className="mt-2 text-sm text-gray-600">Use ________ for the missing word or phrase. Repeated blanks share the same answer.</p>
          <label htmlFor="quiz-correct-answer" className="mt-6 block font-semibold">Correct answer</label>
          <input id="quiz-correct-answer" className={field} value={answer} maxLength={200} disabled={saving} placeholder="Paris" onChange={e => {setAnswer(e.target.value); setMessage("");}} />
          <p className="mt-2 text-sm text-gray-600">This answer belongs to the quiz. It does not change the answer on your card.</p>
          <div className="mt-6 flex items-center gap-3"><button className={btnPrimary} disabled={saving || !dirty}>{saving ? "Saving…" : "Save quiz"}</button><button type="button" className={btnSecondary} disabled={saving || !dirty} onClick={() => {setQuestion(saved.question); setAnswer(saved.answer); setError(""); setMessage("");}}>Discard changes</button></div>
          {message && <p role="status" className="mt-4 text-green-800">{message}</p>}
        </form></Card>
      </>}
  </section>;
}
function AccountEditor() {const {id} = useParams<{id: string}>(); const {user} = useAuth(); return <Editor key={`${user!.id}:${id}`} id={id} />;}
export default function QuizEditorPage() {return <RequireAuth><AccountEditor /></RequireAuth>;}
