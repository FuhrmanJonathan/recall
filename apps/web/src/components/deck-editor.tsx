"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLeaveGuard } from "@/components/use-leave-guard";
import { RequireAuth, useAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

type Flashcard = { id?: number; question: string; answer: string; needs_review: boolean };
type Deck = { id: number; title: string; version: number; flashcards: Flashcard[] };
const field = "w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-ink placeholder:text-gray-500";

function Editor({ deckId }: { deckId: string }) {
  const { user } = useAuth();
  const draftKey = `recall:deck-draft:${user?.id}:${deckId}`;
  const [fromStudy, setFromStudy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [saved, setSaved] = useState("");
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [preview, setPreview] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [draftStored, setDraftStored] = useState(false);
  const [revision, setRevision] = useState(0);
  const [removed, setRemoved] = useState<{ card: Flashcard; index: number } | null>(null);
  const lock = useRef(false);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const dirty = !!deck && JSON.stringify(deck) !== saved;
  useLeaveGuard(dirty, saving);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/decks/${encodeURIComponent(deckId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "This deck could not be found." : "Could not load this deck. Please try again.");
        const next: Deck = await res.json();
        if (!controller.signal.aborted) {
          setSaved(JSON.stringify(next));
          const params = new URLSearchParams(window.location.search);
          setFromStudy(params.get("from") === "study");
          let working = next;
          let fallbackActive = 0;
          let restored: { deck: Deck; active: number } | null = null;
          try { restored = JSON.parse(sessionStorage.getItem(draftKey) ?? "null"); } catch { /* Storage may be unavailable. */ }
          if (restored?.deck?.id === next.id && Array.isArray(restored.deck.flashcards) && typeof restored.deck.version === "number") {
            working = restored.deck;
            fallbackActive = Math.max(0, Math.min(restored.active || 0, working.flashcards.length - 1));
            setMessage("Unsaved draft restored.");
            if (working.version !== next.version) {
              setConflict(true); setError("This deck changed while you were away. Your draft is still here. Copy anything you need, then reload the latest deck.");
            }
          }
          // Explicit card/add links take priority over the last card in a restored draft.
          if (params.get("add") === "1" && working.flashcards.length < 1000) {
            setDeck({ ...working, flashcards: [...working.flashcards, { question: "", answer: "", needs_review: false }] });
            setActive(working.flashcards.length);
            const nextUrl = new URL(window.location.href); nextUrl.searchParams.delete("add");
            window.history.replaceState(window.history.state, "", nextUrl.pathname + nextUrl.search);
            requestAnimationFrame(() => questionRef.current?.focus());
          } else {
            setDeck(working);
            const selected = Number(params.get("card"));
            const selectedIndex = working.flashcards.findIndex((card) => card.id === selected);
            setActive(selectedIndex < 0 ? fallbackActive : selectedIndex);
          }
        }
      })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load deck."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [deckId, revision, draftKey]);

  useEffect(() => {
    if (!deck || loading || !saved) return;
    try {
      if (dirty) { sessionStorage.setItem(draftKey, JSON.stringify({ deck, active })); setDraftStored(true); }
      else { sessionStorage.removeItem(draftKey); setDraftStored(false); }
    } catch { setDraftStored(false); }
  }, [deck, active, dirty, loading, saved, draftKey]);

  function reloadLatest() {
    if (dirty && !window.confirm("Reload the latest saved deck and discard your unsaved draft?")) return;
    try { sessionStorage.removeItem(draftKey); } catch { /* Storage may be unavailable. */ }
    setConflict(false); setDeck(null); setRemoved(null); setMessage(""); setRevision((value) => value + 1);
  }

  function updateCard(changes: Partial<Flashcard>) {
    if (!deck || saving) return;
    setDeck({ ...deck, flashcards: deck.flashcards.map((card, i) => i === active ? { ...card, ...changes } : card) });
    setMessage("");
  }
  function selectCard(index: number) { setActive(index); setFlipped(false); }
  function addCard() {
    if (!deck || deck.flashcards.length >= 1000) return;
    setDeck({ ...deck, flashcards: [...deck.flashcards, { question: "", answer: "", needs_review: false }] });
    selectCard(deck.flashcards.length); setQuery(""); setFlaggedOnly(false); setPreview(false); setMessage("");
    requestAnimationFrame(() => questionRef.current?.focus());
  }
  function removeCard() {
    if (!deck) return;
    setRemoved({ card: deck.flashcards[active], index: active });
    setDeck({ ...deck, flashcards: deck.flashcards.filter((_, i) => i !== active) });
    selectCard(Math.max(0, Math.min(active, deck.flashcards.length - 2))); setMessage("");
  }
  function undoRemove() {
    if (!deck || !removed) return;
    const cards = [...deck.flashcards]; cards.splice(removed.index, 0, removed.card);
    setDeck({ ...deck, flashcards: cards }); selectCard(removed.index); setRemoved(null);
  }
  function reset() {
    if (!dirty || window.confirm("Discard all unsaved edits, including added and removed cards?")) {
      setDeck(JSON.parse(saved)); selectCard(0); setRemoved(null); setConflict(false); setError(""); setMessage("");
    }
  }
  async function save() {
    if (!deck || lock.current || conflict) return;
    if (!deck.title.trim()) { setError("Give your deck a title before saving."); return; }
    const invalid = deck.flashcards.findIndex((card) => !card.question.trim() || !card.answer.trim());
    if (invalid !== -1) {
      selectCard(invalid); setQuery(""); setFlaggedOnly(false); setPreview(false);
      setError(`Card ${invalid + 1} needs both a question and an answer.`); return;
    }
    lock.current = true; setSaving(true); setError(""); setMessage("");
    try {
      const res = await fetch(`/api/decks/${deck.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: deck.title, version: deck.version, flashcards: deck.flashcards }) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) setConflict(true);
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not save your changes. Your edits are still here; please try again.");
      setDeck(body); setSaved(JSON.stringify(body)); setRemoved(null); setConflict(false); setMessage("All changes saved.");
      try { sessionStorage.removeItem(draftKey); } catch { /* Storage may be unavailable. */ }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your changes."); }
    finally { lock.current = false; setSaving(false); }
  }

  if (loading) return <Card className="p-12 text-center"><p role="status" className="text-gray-500">Opening your deck…</p></Card>;
  if (!deck) return <Card className="mx-auto max-w-lg p-8"><h1 className="text-xl font-semibold">Let’s try that again</h1><p role="alert" className="mt-3 text-red-700">{error}</p><div className="mt-6 flex gap-3"><button onClick={() => setRevision((v) => v + 1)} className={btnPrimary}>Try again</button><Link href="/decks" className={btnSecondary}>My decks</Link></div></Card>;

  const card = deck.flashcards[active];
  const flagged = deck.flashcards.filter((c) => c.needs_review).length;
  const visible = deck.flashcards.map((c, index) => ({ ...c, index })).filter((c) => (!flaggedOnly || c.needs_review) && `${c.question} ${c.answer}`.toLowerCase().includes(query.toLowerCase()));
  return <section>
    <div className="mb-8 flex flex-wrap items-center justify-between gap-5">
      <div>
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-sm text-gray-600"><Link href="/decks" className="hover:text-accent">My Decks</Link><span>/</span><Link href={`/decks/${deck.id}`} className="hover:text-accent">Deck details</Link><span>/</span><span className="font-medium text-ink">Edit</span></nav>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Edit your deck</h1>
        <p className="mt-2 text-base text-gray-600">Choose a card to edit its question and answer.</p>
      </div>
      <div className="flex items-center gap-3"><Link href={fromStudy ? "/cards?resume=1" : `/decks/${deck.id}`} className={btnSecondary}>{fromStudy ? "Return to study" : "Back to deck"}</Link><button onClick={() => void save()} disabled={saving || !dirty || conflict} className={btnPrimary}>{saving ? "Saving…" : "Save changes"}</button></div>
    </div>
    <Card className="mb-6 p-5 sm:p-6">
      <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
        <div><label htmlFor="deck-title" className="text-sm font-semibold  text-gray-500">Deck title</label><input id="deck-title" value={deck.title} maxLength={200} disabled={saving} onChange={(e) => { setDeck({ ...deck, title: e.target.value }); setMessage(""); }} className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-lg font-semibold" /></div>
        <div className="flex flex-wrap gap-2 text-sm"><span className="rounded-full bg-blue-50 px-3 py-2 font-medium text-accent">{deck.flashcards.length} cards</span>{flagged > 0 && <span className="rounded-full bg-amber-50 px-3 py-2 text-amber-900">{flagged} to check</span>}</div>
      </div>
    </Card>
    {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><p>{error}</p>{conflict && <button disabled={saving} onClick={reloadLatest} className={`mt-3 ${btnSecondary}`}>Reload latest deck</button>}</div>}
    {removed && <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm"><span>Card removed. Save to apply this change; its review history will also be deleted.</span><button disabled={saving} onClick={undoRemove} className="font-semibold text-accent">Undo</button></div>}
    <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="hidden lg:block min-w-0 rounded-2xl border border-gray-200 bg-white p-5 lg:sticky lg:top-6">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Your cards</h2><button disabled={saving || deck.flashcards.length >= 1000} onClick={addCard} className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-accent">+ Add</button></div>
        <label htmlFor="card-search" className="sr-only">Search cards</label><input id="card-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a card…" className={`${field} mt-4 bg-gray-50`} />
        <label className="my-4 flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} className="accent-blue-600" />Only cards to check ({flagged})</label>
        <div className="max-h-40 space-y-1 overflow-y-auto lg:max-h-[560px]">{visible.map((c) => <button key={c.id ?? `new-${c.index}`} disabled={saving} aria-current={active === c.index ? "true" : undefined} onClick={() => selectCard(c.index)} className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left text-base leading-6 ${active === c.index ? "bg-blue-50 text-accent ring-1 ring-inset ring-blue-100" : "text-gray-600 hover:bg-gray-50"}`}><span className="pt-0.5 text-sm tabular-nums opacity-60">{String(c.index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1"><span className="line-clamp-3 break-words font-medium">{c.question || "Untitled card"}</span>{c.needs_review && <span className="mt-1 block text-sm text-amber-800">Needs a check</span>}</span></button>)}{!visible.length && <p className="py-6 text-center text-sm text-gray-500">{deck.flashcards.length ? "No matching cards." : "Your first card starts here."}</p>}</div>
      </aside>
      <div className="min-w-0">
        <div className="mb-5 flex items-end gap-3 lg:hidden">
          <label className="min-w-0 flex-1 text-sm font-semibold" htmlFor="mobile-card">Choose a card<select id="mobile-card" aria-label="Choose a card" value={active} disabled={saving || !deck.flashcards.length} onChange={(e) => selectCard(Number(e.target.value))} className="mt-2 block w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base font-normal">{deck.flashcards.map((card, index) => <option key={card.id ?? `new-${index}`} value={index}>{index + 1}. {card.question || "Untitled card"}</option>)}</select></label>
          <button disabled={saving || deck.flashcards.length >= 1000} onClick={addCard} className={btnSecondary}>+ Add</button>
        </div>
        {card ? <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-7"><h2 className="text-sm font-semibold">Card {active + 1}<span className="ml-2 font-normal text-gray-500">/ {deck.flashcards.length}</span></h2><div className="flex rounded-lg bg-gray-100 p-1 text-sm"><button aria-pressed={!preview} onClick={() => setPreview(false)} className={`rounded-md px-3 py-2 ${!preview ? "bg-white font-semibold shadow-sm" : "text-gray-500"}`}>Edit content</button><button aria-pressed={preview} onClick={() => { setPreview(true); setFlipped(false); }} className={`rounded-md px-3 py-2 ${preview ? "bg-white font-semibold shadow-sm" : "text-gray-500"}`}>Preview</button></div></div>
          <div className="p-5 sm:p-7">
            {card.needs_review && <div className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><p className="font-medium">Check this card against your notes</p><p className="mt-1 text-sm leading-5">The source may have been difficult to read. Check the question and answer against your notes, then mark it checked below.</p></div>}
            {preview ? <button onClick={() => setFlipped(!flipped)} aria-label={flipped ? "Show question" : "Show answer"} className="flex min-h-80 w-full flex-col items-center justify-between rounded-2xl border border-blue-100 bg-blue-50/40 p-7 text-center"><span className="text-sm font-semibold  text-accent">{flipped ? "Answer" : "Question"}</span><span className="my-8 whitespace-pre-wrap break-words text-2xl leading-relaxed">{(flipped ? card.answer : card.question) || "Your text will appear here"}</span><span className="text-sm text-gray-500">Click to flip the card ↻</span></button> : <div className="space-y-6"><div><div className="mb-2 flex justify-between gap-2"><label htmlFor="question" className="text-sm font-semibold">Question</label></div><textarea ref={questionRef} id="question" value={card.question} maxLength={2000} disabled={saving} onChange={(e) => updateCard({ question: e.target.value })} placeholder="What do you want to remember?" className={`${field} min-h-36 resize-y text-lg leading-8`} /><p className="mt-1 text-right text-sm text-gray-500">{card.question.length} / 2,000</p></div><div><div className="mb-2 flex justify-between gap-2"><label htmlFor="answer" className="text-sm font-semibold">Answer</label></div><textarea id="answer" value={card.answer} maxLength={5000} disabled={saving} onChange={(e) => updateCard({ answer: e.target.value })} placeholder="Keep it clear and focused on one idea." className={`${field} min-h-44 resize-y text-lg leading-8`} /><p className="mt-1 text-right text-sm text-gray-500">{card.answer.length} / 5,000</p></div></div>}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 pt-5"><label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={card.needs_review} disabled={saving} onChange={(e) => updateCard({ needs_review: e.target.checked })} className="h-4 w-4 accent-blue-600" />Needs checking</label><button disabled={saving} onClick={removeCard} className="rounded-lg px-2 py-2 text-sm font-medium text-red-700 hover:bg-red-50">Remove card</button></div>
          </div>
        </Card> : <Card className="p-12 text-center"><p className="text-3xl text-accent" aria-hidden="true">▤</p><h2 className="mt-4 text-xl font-semibold">A fresh start</h2><p className="mt-2 text-sm text-gray-500">Add a question and answer to start building this deck.</p><button disabled={saving} onClick={addCard} className={`mt-6 ${btnPrimary}`}>+ Add your first card</button></Card>}
        {card && <div className="mt-4 flex items-center justify-between"><button disabled={saving || active === 0} onClick={() => selectCard(active - 1)} className={btnSecondary}>← Previous</button><button disabled={saving || active === deck.flashcards.length - 1} onClick={() => selectCard(active + 1)} className={btnSecondary}>Next card →</button></div>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-gray-200 pt-5"><p role="status" aria-live="polite" className={`text-sm ${message ? "text-emerald-700" : "text-gray-500"}`}>{saving ? "Saving your deck…" : message || (dirty ? draftStored ? "Unsaved changes · Draft kept in this tab" : "Unsaved changes" : "All changes saved")}</p><div className="flex items-center gap-3"><button disabled={!dirty || saving} onClick={reset} className="rounded-lg px-2 py-2 text-sm font-medium text-gray-500 hover:text-ink">Discard changes</button><button disabled={!dirty || saving || conflict} onClick={() => void save()} className={btnPrimary}>{saving ? "Saving…" : "Save deck"}</button></div></div>
      </div>
    </div>
  </section>;
}

export default function DeckEditor({ deckId }: { deckId: string }) {
  return <RequireAuth><Editor key={deckId} deckId={deckId} /></RequireAuth>;
}
