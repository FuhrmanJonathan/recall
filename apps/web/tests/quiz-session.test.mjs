import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceProgress, restoreProgress, completionBody } from '../src/lib/quiz-session.ts';
const run = { id: 'run-1', completed_at: null, exercises: [{ answer: 'a' }, { answer: 'b' }], attempts: null };
test('restore only matching, valid progress', () => {
  const saved = {runId: run.id, index: 1, attempts: [{text:'A', revealed:true}, {text:'', revealed:false}]};
  assert.equal(restoreProgress(run, saved).index, 1);
  for (const invalid of [null, {...saved,runId:'other'}, {...saved,index:3}, {...saved,attempts:[]}, {...saved,attempts:[{text:'A',revealed:false},{text:'',revealed:false}]}]) {
    assert.equal(restoreProgress(run, invalid).index, 0);
  }
});
test('server completed results win over local answers', () => {
  const done = {...run, completed_at:'2026-11-09', attempts:[{text:'a',revealed:true,result:'correct'}, {text:'wrong',revealed:true,result:'incorrect'}]};
  assert.deepEqual(restoreProgress(done, {index:0}).attempts, done.attempts);
  assert.equal(restoreProgress(done, null).index, 2);
});
test('completion never submits locally calculated scores', () => {
  assert.deepEqual(completionBody([{text:'wrong',revealed:true,markedCorrect:true,result:'correct'}]), {attempts:[{text:'wrong',revealed:true,markedCorrect:true}]});
});

test('duplicate next clicks cannot skip an unanswered question', () => {
  const initial = {runId: 'run-1', index: 0, attempts: [{text:'a', revealed:true}, {text:'', revealed:false}]};
  const next = advanceProgress(initial, 0);
  assert.equal(next.index, 1);
  assert.strictEqual(advanceProgress(next, 0), next);
  assert.strictEqual(advanceProgress(next, 1), next);
  const answered = {...next, attempts: [initial.attempts[0], {text:'b', revealed:true}]};
  const finished = advanceProgress(answered, 1);
  assert.equal(finished.index, 2);
  assert.strictEqual(advanceProgress(finished, 1), finished);
  assert.strictEqual(advanceProgress(finished, 2), finished);
});
