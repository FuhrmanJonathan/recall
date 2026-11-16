import type { QuizAttempt, QuizResult } from "./quiz-scoring";

export type Exercise = { source_card_id: number; context: string; before: string; answer: string; after: string };
export type SavedAttempt = QuizAttempt & { result: QuizResult };
export type Summary = { correct: number; incorrect: number; unanswered: number; accuracy: number };
export type QuizRun = {
  id: string; parent_id: string | null; mode: "cards" | "missed" | "repeat";
  created_at: string; completed_at: string | null; question_count: number;
  exercises: Exercise[]; attempts: SavedAttempt[] | null; summary: Summary | null;
};
export type Progress = { runId: string; index: number; attempts: QuizAttempt[] };

export function restoreProgress(run: QuizRun, value: unknown): Progress {
  if (run.completed_at && run.attempts) return { runId: run.id, index: run.exercises.length, attempts: run.attempts };
  const empty = { runId: run.id, index: 0, attempts: run.exercises.map(() => ({ text: "", revealed: false, markedCorrect: false })) };
  if (!value || typeof value !== "object") return empty;
  const p = value as Progress;
  if (p.runId !== run.id || !Number.isInteger(p.index) || p.index < 0 || p.index > run.exercises.length
    || !Array.isArray(p.attempts) || p.attempts.length !== run.exercises.length
    || !p.attempts.every((a, i) => a && typeof a.text === "string" && a.text.length <= 2000
      && typeof a.revealed === "boolean" && (i >= p.index || a.revealed)
      && (a.markedCorrect === undefined || typeof a.markedCorrect === "boolean"))) return empty;
  return { runId: run.id, index: p.index, attempts: p.attempts.map(a => ({ text: a.text, revealed: a.revealed, markedCorrect: !!a.markedCorrect })) };
}

export async function quizRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Request failed. Please try again.");
  return body as T;
}

export function completionBody(attempts: QuizAttempt[]) {
  // Results come from the server, never from client-supplied scores.
  return { attempts: attempts.map(a => ({ text: a.text, revealed: a.revealed, markedCorrect: !!a.markedCorrect })) };
}

// A stale or duplicate click must not advance a different question.
export function advanceProgress(progress: Progress | null, expectedIndex: number): Progress | null {
  if (!progress || progress.index !== expectedIndex || !progress.attempts[expectedIndex]?.revealed) return progress;
  return { ...progress, index: expectedIndex + 1 };
}
