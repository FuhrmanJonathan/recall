import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSelection, readSelection, selectionFromUrl, selectionParams } from '../src/lib/study-selection.ts';

test('selection round-trips multiple decks and tags without ambiguous separators', () => {
  const saved = { deckIds: ['3', '7'], tags: ['midterm 2', 'DNA & RNA'], size: 30, shuffle: true };
  assert.deepEqual(selectionFromUrl(selectionParams(saved), defaultSelection), saved);
});

test('a direct deck link overrides remembered tags and decks', () => {
  const saved = { deckIds: ['3'], tags: ['midterm 2'], size: 50, shuffle: false };
  assert.deepEqual(selectionFromUrl(new URLSearchParams('deck=7'), saved), { ...saved, deckIds: ['7'], tags: [] });
  assert.deepEqual(selectionFromUrl(new URLSearchParams('label=biology'), saved), { ...saved, deckIds: [], tags: ['biology'] });
  assert.deepEqual(selectionFromUrl(new URLSearchParams(), saved), saved);
});

test('malformed stored preferences are bounded and safe', () => {
  assert.deepEqual(readSelection(null), defaultSelection);
  assert.deepEqual(readSelection({ deckIds: ['1', '1', '-4', 'no', 2], tags: ['exam', 'exam', '', null, 'a,b'], size: 1001, shuffle: 'true' }),
    { deckIds: ['1'], tags: ['exam'], size: 20, shuffle: false });
});

test('unavailable explicit selections are not silently broadened to all cards', () => {
  const selection = selectionFromUrl(new URLSearchParams('deck=999&tag=deleted-tag'), defaultSelection);
  assert.deepEqual(selection.deckIds, ['999']);
  assert.deepEqual(selection.tags, ['deleted-tag']);
});
