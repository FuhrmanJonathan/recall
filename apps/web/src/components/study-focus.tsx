"use client";

import { useRef, useState } from "react";
import { btnPrimary } from "@/components/ui";
import type { StudySelection } from "@/lib/study-selection";

type Props = {
  selection: StudySelection;
  decks: { id: number; title: string; card_count: number }[];
  tags: string[];
  loading: boolean;
  error: boolean;
  count: number;
  onChange: (selection: StudySelection) => void;
};

export default function StudyFocus({ selection, decks, tags, loading, error, count, onChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase();
  const matchingDecks = decks.filter(deck => deck.title.toLocaleLowerCase().includes(term));
  const matchingTags = [...new Set([...tags, ...selection.tags])].filter(tag => tag.toLocaleLowerCase().includes(term));
  const chosen = selection.deckIds.length + selection.tags.length;
  const toggleDeck = (id: string) => onChange({ ...selection, deckIds: selection.deckIds.includes(id) ? selection.deckIds.filter(value => value !== id) : [...selection.deckIds, id] });
  const toggleTag = (tag: string) => onChange({ ...selection, tags: selection.tags.includes(tag) ? selection.tags.filter(value => value !== tag) : [...selection.tags, tag] });
  function open() {
    setQuery(""); dialog.current?.showModal();
    requestAnimationFrame(() => search.current?.focus());
  }
  return <div>
    <label className="block text-sm font-semibold" id="study-focus-label">What do you want to study?</label>
    <button onClick={open} aria-haspopup="dialog" aria-labelledby="study-focus-label study-focus-value" className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-gray-300 bg-white px-4 py-3 text-left hover:border-accent">
      <span id="study-focus-value">{chosen ? `${selection.deckIds.length ? `${selection.deckIds.length} ${selection.deckIds.length === 1 ? "deck" : "decks"}` : ""}${selection.deckIds.length && selection.tags.length ? " · " : ""}${selection.tags.length ? `${selection.tags.length} ${selection.tags.length === 1 ? "tag" : "tags"}` : ""} selected` : "All decks and tags"}</span>
      <span aria-hidden="true" className="text-gray-500">⌄</span>
    </button>
    {!!chosen && <div className="mt-3 flex flex-wrap items-center gap-2">
      {selection.deckIds.map(id => <button key={`deck-${id}`} onClick={() => toggleDeck(id)} aria-label={`Remove deck ${decks.find(deck => String(deck.id) === id)?.title ?? id}`} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-gray-100 px-3 py-1.5 text-sm"><span className="truncate">{decks.find(deck => String(deck.id) === id)?.title ?? "Unavailable deck"}</span><span aria-hidden="true">×</span></button>)}
      {selection.tags.map(tag => <button key={`tag-${tag}`} onClick={() => toggleTag(tag)} aria-label={`Remove tag ${tag}`} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-sm text-accent"><span className="truncate">#{tag}</span><span aria-hidden="true">×</span></button>)}
      <button onClick={() => onChange({ ...selection, deckIds: [], tags: [] })} className="px-2 py-1.5 text-sm text-gray-600 underline">Clear selection</button>
    </div>}
    {!!selection.deckIds.length && !!selection.tags.length && <p className="mt-2 text-xs text-gray-500">Cards in the selected decks matching any selected tag.</p>}
    <dialog ref={dialog} aria-labelledby="focus-dialog-title" className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white p-0 text-ink shadow-2xl backdrop:bg-gray-950/35" onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3"><h2 id="focus-dialog-title" className="text-xl font-semibold">Choose decks or tags</h2><button aria-label="Close study selection" onClick={() => dialog.current?.close()} className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-gray-500 hover:bg-gray-100">×</button></div>
        <input ref={search} type="search" aria-label="Search decks and tags" placeholder="Search decks or tags…" value={query} onChange={e => setQuery(e.target.value)} className="mt-4 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-base" />
        <div className="mt-4 max-h-[42dvh] space-y-4 overflow-y-auto overscroll-contain">
          {!!matchingDecks.length && <fieldset className="min-w-0"><legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Decks</legend>{matchingDecks.map(deck => <label key={deck.id} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-3 hover:bg-gray-50"><input type="checkbox" checked={selection.deckIds.includes(String(deck.id))} disabled={!selection.deckIds.includes(String(deck.id)) && selection.deckIds.length >= 50} onChange={() => toggleDeck(String(deck.id))} className="h-4 w-4 shrink-0 accent-blue-700" /><span className="min-w-0 flex-1 break-words text-sm font-medium">{deck.title}</span><span className="shrink-0 text-xs text-gray-500">{deck.card_count} cards</span></label>)}</fieldset>}
          {!!matchingTags.length && <fieldset className="min-w-0"><legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">Tags</legend>{matchingTags.map(tag => <label key={tag} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-3 hover:bg-gray-50"><input type="checkbox" checked={selection.tags.includes(tag)} disabled={!selection.tags.includes(tag) && selection.tags.length >= 30} onChange={() => toggleTag(tag)} className="h-4 w-4 shrink-0 accent-blue-700" /><span className="break-words text-sm">#{tag}</span></label>)}</fieldset>}
          {!matchingDecks.length && !matchingTags.length && <p className="py-6 text-center text-sm text-gray-600">{query ? "No decks or tags match your search." : "Your decks and tags will appear here."}</p>}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-gray-100 pt-4"><p role="status" className="text-sm text-gray-600">{error ? "Could not count cards. Close to retry." : loading ? "Finding cards…" : `${count} ${count === 1 ? "card matches" : "cards match"}`}</p><button className={btnPrimary} onClick={() => dialog.current?.close()}>Done</button></div>
      </div>
    </dialog>
    <details className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <summary className="cursor-pointer text-sm text-gray-600">Session options <span className="ml-1 text-xs text-gray-500">· {selection.size} cards{selection.shuffle ? " · shuffled" : ""}</span></summary>
      <div className="mt-4 flex flex-wrap items-center gap-5 border-t border-gray-100 pt-4">
        <label className="text-sm">Cards per session<select aria-label="Cards per session" value={selection.size} onChange={e => onChange({ ...selection, size: Number(e.target.value) })} className="ml-3 rounded-lg border border-gray-300 bg-white px-3 py-2">{[...new Set([10, 20, 30, 50, 100, selection.size])].sort((a,b) => a-b).map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selection.shuffle} onChange={e => onChange({ ...selection, shuffle: e.target.checked })} className="h-4 w-4 accent-blue-700" />Shuffle this session</label>
      </div>
    </details>
  </div>;
}
