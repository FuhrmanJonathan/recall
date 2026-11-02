import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuizAnswer, quizResult, quizSummary } from '../src/lib/quiz-scoring.ts';

test('explicit symbol aliases and whitespace', () => {
  for (const [a, b] of [['σ', 'sigma'], ['Σ', 'SIGMA'], ['∑', 'sigma'], ['α', 'alpha'], ['β', 'beta'], ['μ', 'mu'], ['µ', 'mu'], ['a × b', 'a*b'], ['x ≤ 5', 'x<=5'], ['x ≥ 5', 'x >= 5'], ['x ≠ 5', 'x!=5'], [' Product   Owner ', 'product owner']]) {
    assert.equal(normalizeQuizAnswer(a), normalizeQuizAnswer(b));
  }
});
test('meaningful differences are not erased', () => {
  for (const [a, b] of [['x<5', 'x>5'], ['σ', ''], ['x²', 'x2'], ['-5', '5'], ['a/b', 'ab'], ['0.5', '05']]) {
    assert.notEqual(normalizeQuizAnswer(a), normalizeQuizAnswer(b));
  }
});
test('correct, incorrect, revealed and self-marked answers', () => {
  assert.equal(quizResult('σ', { text: 'sigma', revealed: true }), 'correct');
  assert.equal(quizResult('sigma', { text: 'beta', revealed: true }), 'incorrect');
  assert.equal(quizResult('sigma', { text: '', revealed: true, markedCorrect: true }), 'unanswered');
  assert.equal(quizResult('sigma', { text: 'sigma', revealed: false }), 'unanswered');
  const attempt = { text: 's', revealed: true, markedCorrect: true };
  assert.equal(quizResult('σ', attempt), 'correct');
  assert.equal(quizResult('σ', { ...attempt, markedCorrect: false }), 'incorrect');
});
test('summary, restored overrides and restart', () => {
  const exercises = [{ answer: 'σ' }, { answer: 'x' }, { answer: 'y' }, { answer: 'z' }];
  const attempts = [{ text: 'sigma', revealed: true }, { text: 'wrong', revealed: true }, { text: '', revealed: true }, { text: 'zee', revealed: true, markedCorrect: true }];
  assert.deepEqual(quizSummary(exercises, JSON.parse(JSON.stringify(attempts))), { correct: 2, incorrect: 1, unanswered: 1, accuracy: 50 });
  assert.deepEqual(quizSummary(exercises, exercises.map(() => ({ text: '', revealed: false }))), { correct: 0, incorrect: 0, unanswered: 4, accuracy: 0 });
  assert.equal(quizSummary([], []).accuracy, 0);
});
