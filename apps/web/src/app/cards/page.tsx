"use client";

import { useEffect, useRef, useState } from "react";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

type CardData = { id: number; deck_title: string; question: string; answer: string; labels: string[]; due_at: string | null; status: "new" | "due" | "upcoming" };
type Queue = { cards: CardData[]; total: number };
type Mode = "due" | "practice";
type Rating = "Again" | "Hard" | "Good" | "Easy";
const inputStyle = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const disabled = " disabled:opacity-40 disabled:cursor-not-allowed";

async function check(res: Response) {
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  throw new Error(typeof body.detail === "string" ? body.detail : "Request failed. Please try again.");
}

function LabelEditor({ card, onSaved }: { card: CardData; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function save() {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError("");
    try {
      const labels = draft.split(",").map((name) => name.trim()).filter(Boolean);
      if (labels.length > 10 || labels.some((name) => name.length > 40)) throw new Error("Use up to 10 labels, each up to 40 characters.");
      await check(await fetch(`/api/flashcards/${card.id}/labels`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ labels }) }));
      setEditing(false); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save labels."); }
    finally { lock.current = false; setSaving(false); }
  }
  return <div className="mt-3">
    <div className="flex flex-wrap items-center gap-2">
      {card.labels.length ? card.labels.map((name) => <span key={name} className="rounded-full bg-blue-50 px-2 py-1 text-xs text-accent">{name}</span>) : <span className="text-xs text-gray-500">No labels</span>}
      {!editing && <button className="text-xs text-accent underline" onClick={() => { setDraft(card.labels.join(", ")); setEditing(true); }}>Edit labels</button>}
    </div>
    {editing && <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="block text-sm" htmlFor={`labels-${card.id}`}>Labels for this card</label>
      <input id={`labels-${card.id}`} disabled={saving} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${inputStyle} w-full`} placeholder="biology, chapter 3, exam 1" aria-describedby={`help-${card.id}`} />
      <p id={`help-${card.id}`} className="text-xs text-gray-500">Comma-separated, up to 10 labels, 40 characters each. Saved in lowercase. Leave blank to remove all.</p>
      <button disabled={saving} className={btnPrimary + disabled}>{saving ? "Saving…" : "Save labels"}</button>
      <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(""); }} className={`ml-2 ${btnSecondary}`}>Cancel</button>
    </form>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}

function Study() {
  const [mode, setMode] = useState<Mode>("due");
  const [deckId, setDeckId] = useState("");
  const [label, setLabel] = useState("");
  const [decks, setDecks] = useState<{ id: number; title: string }[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [queue, setQueue] = useState<Queue>({ cards: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [session, setSession] = useState<CardData[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [conflict, setConflict] = useState(false);
  const lock = useRef(false);
  useEffect(() => { setDeckId(new URLSearchParams(window.location.search).get("deck") ?? ""); setReady(true); }, []);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ mode, offset: String(offset), limit: "50" });
        if (deckId) params.set("deck_id", deckId);
        if (label) params.set("label", label);
        const options = { signal: controller.signal, cache: "no-store" as const };
        const [nextQueue, nextDecks, nextLabels] = await Promise.all([
          fetch(`/api/study/cards?${params}`, options).then(check), fetch("/api/decks", options).then(check), fetch("/api/labels", options).then(check),
        ]);
        if (!controller.signal.aborted) { setQueue(nextQueue); setDecks(nextDecks); setLabels(nextLabels); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load cards."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [ready, mode, deckId, label, offset, revision]);
  function reload() { setOffset(0); setLoading(true); setRevision((value) => value + 1); }
  function back() {
    if (lock.current) return;
    setSession(null); setIndex(0); setFlipped(false); setSaveError(""); setConflict(false); reload();
  }
  async function rate(rating: Rating) {
    const card = session?.[index];
    if (!card || !flipped || mode !== "due" || lock.current || conflict) return;
    lock.current = true; setSaving(true); setSaveError("");
    try {
      const res = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flashcard_id: card.id, rating }) });
      if (res.status === 409) setConflict(true);
      await check(res);
      setFlipped(false); setIndex((value) => value + 1);
    } catch (e) { setSaveError(e instanceof Error ? e.message : "Review not saved. Please try again."); }
    finally { lock.current = false; setSaving(false); }
  }
  if (session) {
    const card = session[index];
    return <section className="mx-auto max-w-2xl">
      <button disabled={saving} onClick={back} className={btnSecondary + disabled}>← Back to list</button>
      <h1 className="mt-6 text-3xl font-bold">{mode === "due" ? "Scheduled review" : "Free practice"}</h1>
      <p className="mt-2 text-sm text-gray-500">{mode === "due" ? "Ratings update your SM-2 schedule after saving." : "Practice only — no ratings, review history, or schedule changes."}</p>
      <p role="status" className="mt-4 text-sm">{card ? `${index + 1} of ${session.length}` : "Session complete"}</p>
      {card ? <>
        <p className="mt-3 text-sm text-gray-500">{card.deck_title}</p>
        <button aria-label={flipped ? "Show question" : "Show answer"} disabled={saving} onClick={() => setFlipped(!flipped)} className="mt-3 block w-full text-left">
          <Card className="min-h-64 p-8"><span className="text-xs text-gray-500">{flipped ? "Answer" : "Question"}</span><p className="my-8 whitespace-pre-wrap break-words text-center text-2xl">{flipped ? card.answer : card.question}</p><p className="text-center text-xs text-gray-500">Click to flip</p></Card>
        </button>
        {mode === "practice" ? <button disabled={!flipped} className={`mt-4 ${btnPrimary}${disabled}`} onClick={() => { setFlipped(false); setIndex((value) => value + 1); }}>Next card</button> : <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{(["Again", "Hard", "Good", "Easy"] as Rating[]).map((rating) => <button key={rating} disabled={!flipped || saving || conflict} onClick={() => void rate(rating)} className={btnSecondary + disabled}>{rating}</button>)}</div>}
        {saving && <p role="status" className="mt-3 text-sm">Saving review…</p>}
        {saveError && <div role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800"><p>{saveError}</p><p className="mt-2">Your place has been kept. {conflict ? "Reload the list to get the current schedule." : "Retry the rating or reload the list to check the saved state."}</p><button disabled={saving} onClick={back} className={`mt-3 ${btnSecondary}`}>Reload list</button></div>}
      </> : <Card className="mt-6 p-8 text-center"><h2 className="text-xl font-semibold">{mode === "due" ? "Reviews saved" : "Practice complete"}</h2><p className="mt-2 text-sm text-gray-500">{mode === "due" ? "Your next review times are saved. Return to the list for any remaining cards." : "Your SM-2 schedule and review history are unchanged."}</p><button onClick={back} className={`mt-5 ${btnPrimary}`}>Return to list</button>{mode === "practice" && <button onClick={() => { setIndex(0); setFlipped(false); }} className={`ml-3 mt-5 ${btnSecondary}`}>Practice again</button>}</Card>}
    </section>;
  }
  function filter(action: () => void) { action(); reload(); }
  return <section className="mx-auto max-w-3xl">
    <h1 className="text-3xl font-bold">Study cards</h1><p className="mt-2 text-sm text-gray-500">Review what’s due, or practice any time. Organize individual cards with labels.</p>
    <div className="mt-6 flex flex-wrap gap-2" aria-label="Study mode"><button aria-pressed={mode === "due"} onClick={() => filter(() => setMode("due"))} className={mode === "due" ? btnPrimary : btnSecondary}>Due reviews + new cards</button><button aria-pressed={mode === "practice"} onClick={() => filter(() => setMode("practice"))} className={mode === "practice" ? btnPrimary : btnSecondary}>Free practice</button></div>
    <p className="mt-3 text-sm text-gray-500">{mode === "due" ? "Overdue and due-now cards first, then new cards. Future cards are excluded." : "All matching cards, including those not due yet. Practice does not change your schedule."}</p>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="text-sm">Deck<select value={deckId} onChange={(e) => filter(() => setDeckId(e.target.value))} className={`${inputStyle} mt-1 block w-full`}><option value="">All decks</option>{decks.map((deck) => <option key={deck.id} value={String(deck.id)}>{deck.title}</option>)}</select></label>
      <label className="text-sm">Label<select value={label} onChange={(e) => filter(() => setLabel(e.target.value))} className={`${inputStyle} mt-1 block w-full`}><option value="">All labels</option>{[...new Set([...labels, ...(label ? [label] : [])])].sort().map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
    </div>
    {loading ? <p role="status" className="mt-8">Loading cards…</p> : error ? <Card className="mt-6 p-5"><p role="alert" className="text-red-700">{error}</p><button onClick={reload} className={`mt-3 ${btnSecondary}`}>Try again</button></Card> : <>
      <div className="my-6 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm">{queue.total} matching cards{queue.cards.length > 0 && ` · Showing ${offset + 1}–${offset + queue.cards.length}`}</p><button disabled={!queue.cards.length} onClick={() => { setSession(queue.cards); setIndex(0); setFlipped(false); setSaveError(""); setConflict(false); }} className={btnPrimary + disabled}>{mode === "due" ? "Review this page" : "Practice this page"}</button></div>
      {!queue.cards.length && <Card className="p-6"><p>{mode === "due" ? "No due or new cards match these filters." : "No cards match these filters."}</p><p className="mt-2 text-sm text-gray-500">{mode === "due" ? "Try free practice, change your filters, or return when cards are due." : "Change your filters or add cards to a deck first."}</p></Card>}
      <div className="space-y-3">{queue.cards.map((card) => <Card key={card.id} className="p-5"><div className="flex flex-wrap justify-between gap-2 text-xs text-gray-500"><span>{card.deck_title}</span><span>{card.status === "new" ? "New card" : `${card.status === "due" ? "Due" : "Next review"}: ${new Date(card.due_at!).toLocaleString()}`}</span></div><h2 className="mt-2 whitespace-pre-wrap break-words font-medium">{card.question}</h2><LabelEditor card={card} onSaved={reload} /></Card>)}</div>
      <div className="mt-6 flex flex-wrap gap-3"><button disabled={offset === 0} className={btnSecondary + disabled} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - 50)); }}>Previous page</button><button disabled={offset + queue.cards.length >= queue.total} className={btnSecondary + disabled} onClick={() => { setLoading(true); setOffset(offset + 50); }}>Next page</button><button onClick={reload} className={btnSecondary}>Refresh list</button></div>
    </>}
  </section>;
}

export default function CardsPage() { return <RequireAuth><Study /></RequireAuth>; }
