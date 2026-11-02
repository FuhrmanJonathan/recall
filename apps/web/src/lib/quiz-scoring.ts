export type QuizAttempt = { text: string; revealed: boolean; markedCorrect?: boolean };
export type QuizResult = "correct" | "incorrect" | "unanswered";

// Only explicit equivalents are normalized; meaningful operators are never removed.
const symbols: Record<string, string> = {
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon",
  "θ": "theta", "λ": "lambda", "μ": "mu", "µ": "mu", "π": "pi",
  "ρ": "rho", "σ": "sigma", "ς": "sigma", "∑": "sigma", "φ": "phi",
  "ω": "omega", "τ": "tau", "∞": "infinity",
};

export function normalizeQuizAnswer(text: string): string {
  return text.normalize("NFC").toLowerCase()
    .replace(/[αβγδεθλμµπρσς∑φωτ∞]/g, symbol => ` ${symbols[symbol]} `)
    .replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-")
    .replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/≠/g, "!=")
    .trim().replace(/\s+/g, " ")
    .replace(/\s*([*\/+=<>!−-])\s*/g, "$1");
}

export function quizResult(answer: string, attempt: QuizAttempt): QuizResult {
  if (!attempt.revealed || !attempt.text.trim()) return "unanswered";
  return attempt.markedCorrect || normalizeQuizAnswer(answer) === normalizeQuizAnswer(attempt.text)
    ? "correct" : "incorrect";
}

export function quizSummary(exercises: { answer: string }[], attempts: QuizAttempt[]) {
  const counts = { correct: 0, incorrect: 0, unanswered: 0 };
  exercises.forEach((exercise, i) => {
    counts[quizResult(exercise.answer, attempts[i] ?? { text: "", revealed: false })]++;
  });
  return { ...counts, accuracy: exercises.length ? Math.round(counts.correct / exercises.length * 100) : 0 };
}
