"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLeaveGuard } from "@/components/use-leave-guard";
import { RequireAuth, useAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

type CardData = { id: number; deck_id: number; deck_title: string; question: string; answer: string; labels: string[]; due_at: string | null; status: "new" | "due" | "upcoming" };
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
      {card.labels.length ? card.labels.map((name) => <span key={name} className="rounded-full bg-blue-50 px-2 py-1 text-sm text-accent">{name}</span>) : null}
      {!editing && <button className="text-sm text-accent underline" onClick={() => { setDraft(card.labels.join(", ")); setEditing(true); }}>{card.labels.length ? "Edit labels" : "+ Add labels"}</button>}
    </div>
    {editing && <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="block text-sm" htmlFor={`labels-${card.id}`}>Labels for this card</label>
      <input id={`labels-${card.id}`} disabled={saving} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${inputStyle} w-full`} placeholder="biology, chapter 3, exam 1" aria-describedby={`help-${card.id}`} />
      <p id={`help-${card.id}`} className="text-sm text-gray-500">Comma-separated, up to 10 labels, 40 characters each. Saved in lowercase. Leave blank to remove all.</p>
      <button disabled={saving} className={btnPrimary + disabled}>{saving ? "Saving…" : "Save labels"}</button>
      <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(""); }} className={`ml-2 ${btnSecondary}`}>Cancel</button>
    </form>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}

type StudySnapshot = { mode: Mode; deckId: string; label: string; offset: number; session: CardData[]; index: number };

function Study() {
  const { user } = useAuth();
  const sessionKey = `recall:study:${user?.id}`;
  const cardRef = useRef<HTMLButtonElement>(null);
  const completedRef = useRef<HTMLHeadingElement>(null);
  const [resumeError, setResumeError] = useState("");
  const [resumeRevision, setResumeRevision] = useState(0);
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
  useLeaveGuard(false, saving);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      const params = new URLSearchParams(window.location.search);
      setReady(false); setResumeError("");
      setDeckId(params.get("deck") ?? "");
      setMode(params.get("mode") === "practice" ? "practice" : "due");
      setLabel(params.get("label") ?? "");
      if (params.get("resume") === "1") {
        try {
          const saved: StudySnapshot | null = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
          if (!saved || !Array.isArray(saved.session)) throw new Error("Your previous session is no longer available. Choose cards below to start again.");
          const remaining = saved.session.slice(saved.index);
          const deckIds = [...new Set(remaining.map((card) => card.deck_id))];
          const decks = await Promise.all(deckIds.map((id) => fetch(`/api/decks/${id}`, { signal: controller.signal, cache: "no-store" }).then(async (res) => {
            if (res.status === 404) return null;
            return check(res);
          })));
          const freshCards = new Map<number, { question: string; answer: string; title: string }>();
          for (const deck of decks) if (deck) for (const card of deck.flashcards) freshCards.set(card.id, { question: card.question, answer: card.answer, title: deck.title });
          const restored = remaining.filter((card) => freshCards.has(card.id)).map((card) => {
            const fresh = freshCards.get(card.id)!;
            return { ...card, question: fresh.question, answer: fresh.answer, deck_title: fresh.title };
          });
          if (controller.signal.aborted) return;
          setMode(saved.mode); setDeckId(saved.deckId); setLabel(saved.label); setOffset(saved.offset);
          setIndex(0); setFlipped(false); setSession(restored.length ? restored : null);
        } catch (e) {
          if (!controller.signal.aborted) setResumeError(e instanceof Error ? e.message : "Could not restore your session. Your saved cards are safe.");
        }
      }
      if (!controller.signal.aborted) setReady(true);
    }
    void initialize(); return () => controller.abort();
  }, [sessionKey, resumeRevision]);

  useEffect(() => {
    if (!ready || !session) return;
    try { sessionStorage.setItem(sessionKey, JSON.stringify({ mode, deckId, label, offset, session, index } satisfies StudySnapshot)); } catch { /* Storage may be disabled. */ }
  }, [ready, session, index, mode, deckId, label, offset, sessionKey]);

  useEffect(() => {
    if (!session) return;
    if (session[index]) cardRef.current?.focus();
    else completedRef.current?.focus();
  }, [session, index, flipped]);

  useEffect(() => {
    if (!ready || session) return;
    const params = new URLSearchParams();
    if (deckId) params.set("deck", deckId);
    if (mode === "practice") params.set("mode", mode);
    if (label) params.set("label", label);
    window.history.replaceState(window.history.state, "", `/cards${params.size ? `?${params}` : ""}`);
  }, [ready, session, mode, deckId, label]);
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
    try { sessionStorage.removeItem(sessionKey); } catch { /* Storage may be disabled. */ }
    setSession(null); setIndex(0); setFlipped(false); setSaveError(""); setConflict(false); reload();
  }
  function start(startIndex = 0) {
    setSession(queue.cards.slice(startIndex)); setIndex(0); setFlipped(false);
    setSaveError(""); setConflict(false);
    window.scrollTo({ top: 0 });
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
  if (!ready) return <section className="mx-auto max-w-3xl"><h1 className="text-3xl font-semibold">Study</h1><p role="status" className="mt-6 text-gray-600">Opening your study session…</p></section>;
  if (session) {
    const card = session[index];
    return <section className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <button disabled={saving} onClick={back} className={btnSecondary + disabled}>← Back to cards</button>
        {card && <Link href={`/decks/${card.deck_id}/edit?card=${card.id}&from=study`} className="text-sm font-semibold text-accent hover:underline">Edit this card</Link>}
      </div>
      <div className="mt-7 flex items-end justify-between gap-4"><h1 className="text-3xl font-semibold">{mode === "due" ? "Review" : "Practice"}</h1><p role="status" aria-live="polite" className="text-sm text-gray-600">{card ? `Card ${index + 1} of ${session.length}` : "Complete"}</p></div>
      {card ? <>
        <Link href={`/decks/${card.deck_id}`} className="mt-3 inline-block text-sm text-gray-600 hover:text-accent">{card.deck_title} ↗</Link>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className="h-full bg-accent" style={{ width: `${index / session.length * 100}%` }} /></div>
        <button ref={cardRef} aria-describedby="study-card-content" aria-label={flipped ? "Answer. Flip to question" : "Question. Flip to answer"} disabled={saving} onClick={() => setFlipped(!flipped)} className="mt-6 block w-full rounded-2xl text-left">
          <Card className="flex min-h-72 flex-col justify-between p-7 sm:p-10"><span className="text-sm font-semibold text-gray-600">{flipped ? "Answer" : "Question"}</span><p id="study-card-content" className="my-9 whitespace-pre-wrap break-words text-center text-2xl leading-relaxed">{flipped ? card.answer : card.question}</p><span className="text-center text-sm text-accent">{flipped ? "Show question ↻" : "Show answer ↻"}</span></Card>
        </button>
        {!flipped ? <button disabled={saving} onClick={() => setFlipped(true)} className={`mt-5 w-full ${btnPrimary}`}>Show answer</button> : mode === "practice" ? <button className={`mt-5 w-full ${btnPrimary}`} onClick={() => { setFlipped(false); setIndex((value) => value + 1); }}>Next card →</button> : <div className="mt-6">
          <div className="grid grid-cols-4 gap-2">{(["Again", "Hard", "Good", "Easy"] as Rating[]).map((rating) => <button key={rating} disabled={saving || conflict} onClick={() => void rate(rating)} className="rounded-xl border border-gray-300 bg-white px-3 py-3 text-center text-base font-semibold transition-colors hover:border-accent hover:bg-blue-50 focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50">{rating}</button>)}</div>
        </div>}
        {saving && <p role="status" className="mt-3 text-sm">Saving review…</p>}
        {saveError && <div role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800"><p>{saveError}</p><p className="mt-2">{conflict ? "This card changed elsewhere. Reload the list to continue." : "Your place is saved. Try the rating again."}</p><button disabled={saving} onClick={back} className={`mt-3 ${btnSecondary}`}>Reload cards</button></div>}
      </> : <Card className="mt-6 p-8 text-center"><h2 ref={completedRef} tabIndex={-1} className="text-xl font-semibold">{mode === "due" ? "Reviews saved" : "Practice complete"}</h2><p className="mt-2 text-base text-gray-600">{mode === "due" ? "Your next review dates have been updated." : "Your review schedule has stayed the same."}</p><button onClick={back} className={`mt-5 ${btnPrimary}`}>Back to cards</button>{mode === "practice" && <button onClick={() => { setIndex(0); setFlipped(false); }} className={`ml-3 mt-5 ${btnSecondary}`}>Practice again</button>}</Card>}
    </section>;
  }
  function filter(action: () => void) { action(); reload(); }
  return <section className="mx-auto max-w-3xl">
    <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Study</h1>
    {resumeError && <div role="alert" className="mt-5 rounded-xl bg-amber-50 p-4 text-amber-900"><p>{resumeError}</p><button onClick={() => { window.history.replaceState(window.history.state, "", "/cards?resume=1"); setResumeRevision((value) => value + 1); }} className={`mt-3 ${btnSecondary}`}>Retry returning to study</button></div>}
    <div className="mt-7 grid gap-3 sm:grid-cols-2" role="group" aria-label="Study mode">
      <button aria-pressed={mode === "due"} onClick={() => filter(() => setMode("due"))} className={`rounded-xl border p-5 text-left ${mode === "due" ? "border-accent bg-blue-50 ring-1 ring-accent" : "border-gray-300 bg-white hover:border-accent"}`}><span className="flex items-center justify-between text-base font-semibold">Review due cards<span aria-hidden="true">{mode === "due" ? "●" : "○"}</span></span><span className="mt-2 block text-sm text-gray-600">New cards and cards due now. Ratings update your review schedule.</span></button>
      <button aria-pressed={mode === "practice"} onClick={() => filter(() => setMode("practice"))} className={`rounded-xl border p-5 text-left ${mode === "practice" ? "border-accent bg-blue-50 ring-1 ring-accent" : "border-gray-300 bg-white hover:border-accent"}`}><span className="flex items-center justify-between text-base font-semibold">Practice all cards<span aria-hidden="true">{mode === "practice" ? "●" : "○"}</span></span><span className="mt-2 block text-sm text-gray-600">Include cards that aren’t due. Your review schedule stays the same.</span></button>
    </div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Deck<select value={deckId} onChange={(e) => filter(() => setDeckId(e.target.value))} className={`${inputStyle} mt-2 block w-full`}><option value="">All decks</option>{decks.map((deck) => <option key={deck.id} value={String(deck.id)}>{deck.title}</option>)}</select></label>
      <label className="text-sm font-medium">Label<select value={label} onChange={(e) => filter(() => setLabel(e.target.value))} className={`${inputStyle} mt-2 block w-full`}><option value="">All labels</option>{[...new Set([...labels, ...(label ? [label] : [])])].sort().map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
    </div>
    {loading ? <p role="status" className="mt-8">Loading cards…</p> : error ? <Card className="mt-6 p-5"><p role="alert" className="text-red-700">{error}</p><button onClick={reload} className={`mt-3 ${btnSecondary}`}>Try again</button></Card> : <>
      <div className="my-6 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-base">{queue.total} {mode === "due" ? "cards ready to review" : "cards to practice"}{queue.total > queue.cards.length && ` · Showing ${offset + 1}–${offset + queue.cards.length}`}</p><button disabled={!queue.cards.length} onClick={() => start()} className={btnPrimary + disabled}>{mode === "due" ? "Start review" : "Start practice"}{queue.cards.length > 0 && ` (${queue.cards.length})`} →</button></div>
      {!queue.cards.length && <Card className="p-6"><p>{mode === "due" ? "You’re caught up for these filters." : "No cards match these filters."}</p><div className="mt-4 flex flex-wrap gap-3">{mode === "due" && <button onClick={() => filter(() => setMode("practice"))} className={btnPrimary}>Practice these cards instead</button>}<Link href="/decks" className={btnSecondary}>Go to My Decks</Link></div></Card>}
      <div className="space-y-4">{queue.cards.map((card, cardIndex) => <Card key={card.id} className="overflow-hidden">
        <button onClick={() => start(cardIndex)} className="group block w-full p-5 text-left hover:bg-blue-50/50 sm:p-6" aria-label={`${mode === "due" ? "Review" : "Practice"} card: ${card.question}`}>
          <span className="flex flex-wrap justify-between gap-2 text-sm text-gray-600"><span>{card.deck_title}</span><span>{card.status === "new" ? "New" : `${card.status === "due" ? "Due" : "Next review"}: ${new Date(card.due_at!).toLocaleDateString()}`}</span></span>
          <span className="mt-3 block whitespace-pre-wrap break-words text-lg font-semibold leading-7 group-hover:text-accent">{card.question}</span>
          <span className="mt-4 inline-block text-sm font-semibold text-accent">{mode === "due" ? "Review from this card" : "Practice from this card"} →</span>
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 pb-4 sm:px-6"><LabelEditor card={card} onSaved={reload} /><Link href={`/decks/${card.deck_id}/edit?card=${card.id}`} className="mt-3 text-sm font-semibold text-accent hover:underline">Edit this card</Link></div>
      </Card>)}</div>
      {queue.total > 50 && <div className="mt-6 flex flex-wrap items-center gap-3"><button disabled={offset === 0} className={btnSecondary + disabled} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - 50)); }}>← Previous 50</button><button disabled={offset + queue.cards.length >= queue.total} className={btnSecondary + disabled} onClick={() => { setLoading(true); setOffset(offset + 50); }}>Next 50 →</button></div>}
    </>}
  </section>;
}

export default function CardsPage() { return <RequireAuth><Study /></RequireAuth>; }
