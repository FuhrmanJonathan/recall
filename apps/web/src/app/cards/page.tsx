"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import Yogo from "@/components/yogo";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLeaveGuard } from "@/components/use-leave-guard";
import { RequireAuth, useAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";
import StudyFocus from "@/components/study-focus";
import { defaultSelection, readSelection, selectionFromUrl, selectionParams, shuffled, type StudySelection } from "@/lib/study-selection";

type CardData = { id: number; deck_id: number; deck_title: string; question: string; answer: string; quiz_ready: boolean; labels: string[]; due_at: string | null; status: "new" | "due" | "upcoming" };
type Queue = { cards: CardData[]; total: number };
type Mode = "due" | "practice";
type Rating = "Again" | "Hard" | "Good" | "Easy";
const ratings: Rating[] = ["Again", "Hard", "Good", "Easy"];
const inputStyle = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const disabled = " disabled:opacity-40 disabled:cursor-not-allowed";

async function check(res: Response) {
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  throw new Error(typeof body.detail === "string" ? body.detail : "Request failed. Please try again.");
}

type LabelInfo = { name: string; color: string };

const PALETTE: Record<string, { bg: string; fg: string }> = {
  gray:   { bg: "#f3f4f6", fg: "#374151" },
  red:    { bg: "#fee2e2", fg: "#991b1b" },
  orange: { bg: "#ffedd5", fg: "#9a3412" },
  yellow: { bg: "#fef9c3", fg: "#854d0e" },
  green:  { bg: "#dcfce7", fg: "#166534" },
  teal:   { bg: "#ccfbf1", fg: "#115e59" },
  blue:   { bg: "#dbeafe", fg: "#1e40af" },
  purple: { bg: "#f3e8ff", fg: "#6b21a8" },
  pink:   { bg: "#fce7f3", fg: "#9d174d" },
};
const COLOR_KEYS = Object.keys(PALETTE);
const colorStyle = (c?: string) => { const p = PALETTE[c ?? ""] ?? PALETTE.blue; return { backgroundColor: p.bg, color: p.fg }; };
function defaultColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOR_KEYS[h % COLOR_KEYS.length];
}

function LabelChip({ name, color, children }: { name: string; color: string; children?: React.ReactNode }) {
  return <span style={colorStyle(color)} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm">{name}{children}</span>;
}

function LabelEditor({ card, allLabels, onSaved }: { card: CardData; allLabels: LabelInfo[]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<LabelInfo[]>([]);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  const colorOf = (name: string) => allLabels.find((l) => l.name === name)?.color ?? defaultColor(name);

  const q = text.toLowerCase();
  const suggestions = q
    ? allLabels
        .filter((l) => !items.some((i) => i.name === l.name) && l.name.includes(q))
        .sort((a, b) => Number(b.name.startsWith(q)) - Number(a.name.startsWith(q)) || a.name.localeCompare(b.name))
        .slice(0, 6)
    : [];
  const top = suggestions.find((s) => s.name.startsWith(q));
  const ghost = top ? top.name.slice(q.length) : "";

  function startEditing() {
    setItems(card.labels.map((name) => ({ name, color: colorOf(name) })));
    setText(""); setActive(0); setPaletteFor(null); setError(""); setEditing(true);
  }
  function add(raw: string): LabelInfo[] {
    const name = raw.trim().toLowerCase();
    if (!name) return items;
    if (items.some((i) => i.name === name)) { setText(""); return items; }
    if (name.length > 40) { setError("Labels can be up to 40 characters."); return items; }
    if (items.length >= 10) { setError("Use up to 10 labels."); return items; }
    const next = [...items, { name, color: colorOf(name) }];
    setItems(next); setText(""); setActive(0); setError("");
    return next;
  }
  function setColor(name: string, color: string) {
    setItems((list) => list.map((i) => (i.name === name ? { ...i, color } : i)));
    setPaletteFor(null);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && suggestions.length) { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
    else if (e.key === "ArrowUp" && suggestions.length) { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === "Enter" && text.trim()) { e.preventDefault(); add(suggestions[active]?.name ?? text); }
    else if (e.key === "Tab" && top && text) { e.preventDefault(); add(top.name); }
    else if (e.key === "," ) { e.preventDefault(); add(text); }
    else if (e.key === "Backspace" && !text && items.length) setItems((l) => l.slice(0, -1));
    else if (e.key === "Escape") setText("");
  }

  async function save() {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError("");
    try {
      const finalItems = text.trim() ? add(text) : items;
      await check(await fetch(`/api/flashcards/${card.id}/labels`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: finalItems }),
      }));
      setEditing(false); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save labels."); }
    finally { lock.current = false; setSaving(false); }
  }

  return <div className="mt-3">
    <div className="flex flex-wrap items-center gap-2">
      {card.labels.map((name) => <LabelChip key={name} name={name} color={colorOf(name)} />)}
      {!editing && <button className="text-sm text-accent underline" onClick={startEditing}>{card.labels.length ? "Edit labels" : "+ Add labels"}</button>}
    </div>

    {editing && <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="block text-sm" htmlFor={`labels-${card.id}`}>Labels for this card</label>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-300 bg-white p-2">
        {items.map((item) => <LabelChip key={item.name} name={item.name} color={item.color}>
          <button type="button" aria-label={`Change color of ${item.name}`} onClick={() => setPaletteFor(paletteFor === item.name ? null : item.name)}
            className="h-3 w-3 rounded-full border border-black/20" style={{ backgroundColor: PALETTE[item.color]?.fg }} />
          <button type="button" aria-label={`Remove ${item.name}`} onClick={() => setItems((l) => l.filter((i) => i.name !== item.name))} className="leading-none">×</button>
        </LabelChip>)}

        <div className="relative min-w-[8rem] flex-1">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center whitespace-pre px-1 text-sm">
            <span className="invisible">{text}</span><span className="text-gray-400">{ghost}</span>
          </div>
          <input id={`labels-${card.id}`} disabled={saving} value={text} autoComplete="off"
            onChange={(e) => { setText(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
            role="combobox" aria-expanded={suggestions.length > 0} aria-controls={`sugg-${card.id}`} aria-autocomplete="list"
            className="relative w-full bg-transparent px-1 py-1 text-sm outline-none" placeholder={items.length ? "" : "biology, chapter 3…"} aria-describedby={`help-${card.id}`} />
        </div>
      </div>

      {suggestions.length > 0 && <ul id={`sugg-${card.id}`} role="listbox" className="rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
        {suggestions.map((s, i) => <li key={s.name} role="option" aria-selected={i === active}>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); add(s.name); }} onMouseEnter={() => setActive(i)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${i === active ? "bg-gray-100" : ""}`}>
            <LabelChip name={s.name} color={s.color} />
          </button>
        </li>)}
      </ul>}

      {paletteFor && <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Color for ${paletteFor}`}>
        <span className="text-sm text-gray-600">Color for “{paletteFor}”:</span>
        {COLOR_KEYS.map((key) => <button key={key} type="button" aria-label={key} title={key} onClick={() => setColor(paletteFor, key)}
          className={`h-6 w-6 rounded-full border-2 ${items.find((i) => i.name === paletteFor)?.color === key ? "border-gray-900" : "border-white ring-1 ring-gray-300"}`}
          style={{ backgroundColor: PALETTE[key].bg }} />)}
      </div>}

      <p id={`help-${card.id}`} className="text-sm text-gray-500">Type to search your labels. Tab or Enter adds one; comma adds a new one. Click the dot on a label to change its color. Up to 10 labels, 40 characters each.</p>
      <button disabled={saving} className={btnPrimary + disabled}>{saving ? "Saving…" : "Save labels"}</button>
      <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(""); }} className={`ml-2 ${btnSecondary}`}>Cancel</button>
    </form>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}

type StudySnapshot = { mode: Mode; selection?: StudySelection; deckId?: string; label?: string; offset: number; session: CardData[]; index: number };

function Study() {
  const router = useRouter();
  const [quizSelection, setQuizSelection] = useState<number[]>([]);
  const { user } = useAuth();
  const sessionKey = `recall:study:${user?.id}`;
  const selectionKey = `recall:study-selection:${user?.id}`;
  const cardRef = useRef<HTMLButtonElement>(null);
  const completedRef = useRef<HTMLHeadingElement>(null);
  const [resumeError, setResumeError] = useState("");
  const [resumeRevision, setResumeRevision] = useState(0);
  const [mode, setMode] = useState<Mode>("due");
  const [selection, setSelection] = useState<StudySelection>(defaultSelection);
  const [decks, setDecks] = useState<{ id: number; title: string; card_count: number }[]>([]);
  const [labels, setLabels] = useState<LabelInfo[]>([]);
  const [queue, setQueue] = useState<Queue>({ cards: [], total: 0 });
  const quizCards = queue.cards.filter(c => c.quiz_ready);
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
      setSession(null); setIndex(0); setFlipped(false);
      let remembered = defaultSelection;
      try { remembered = readSelection(JSON.parse(localStorage.getItem(selectionKey) ?? "null")); } catch { /* Preferences are optional when storage is unavailable. */ }
      setSelection(selectionFromUrl(params, remembered));
      setMode(params.get("mode") === "practice" ? "practice" : "due");
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
          setMode(saved.mode); setSelection(readSelection(saved.selection ?? { deckIds: saved.deckId ? [saved.deckId] : [], tags: saved.label ? [saved.label] : [] })); setOffset(saved.offset);
          setIndex(0); setFlipped(false); setSession(restored.length ? restored : null);
        } catch (e) {
          if (!controller.signal.aborted) setResumeError(e instanceof Error ? e.message : "Could not restore your session. Your saved cards are safe.");
        }
      }
      if (!controller.signal.aborted) setReady(true);
    }
    void initialize(); return () => controller.abort();
  }, [sessionKey, selectionKey, resumeRevision]);

  useEffect(() => {
    if (!ready || !session) return;
    try { sessionStorage.setItem(sessionKey, JSON.stringify({ mode, selection, offset, session, index } satisfies StudySnapshot)); } catch { /* Storage may be disabled. */ }
  }, [ready, session, index, mode, selection, offset, sessionKey]);

  useEffect(() => {
    if (!session) return;
    if (session[index]) cardRef.current?.focus();
    else completedRef.current?.focus();
  }, [session, index, flipped]);

  useEffect(() => {
    if (!ready || session) return;
    const params = selectionParams(selection);
    if (mode === "practice") params.set("mode", mode);
    window.history.replaceState(window.history.state, "", `/cards${params.size ? `?${params}` : ""}`);
    try { localStorage.setItem(selectionKey, JSON.stringify(selection)); } catch { /* The current selection still works without browser storage. */ }
  }, [ready, session, mode, selection, selectionKey]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ mode, offset: String(offset), limit: String(selection.size) });
        selection.deckIds.forEach(id => params.append("deck_ids", id));
        selection.tags.forEach(tag => params.append("labels", tag));
        const options = { signal: controller.signal, cache: "no-store" as const };
        const [nextQueue, nextDecks, nextLabels] = await Promise.all([
          fetch(`/api/study/cards?${params}`, options).then(check), fetch("/api/decks", options).then(check), fetch("/api/labels?colors=true", options).then(check),
        ]);
        if (!controller.signal.aborted) { setQueue(nextQueue); setDecks(nextDecks); setLabels(nextLabels); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load cards."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [ready, mode, selection, offset, revision]);
  function reload() { setQuizSelection([]); setOffset(0); setLoading(true); setRevision((value) => value + 1); }
  function back() {
    if (lock.current) return;
    try { sessionStorage.removeItem(sessionKey); } catch { /* Storage may be disabled. */ }
    setSession(null); setIndex(0); setFlipped(false); setSaveError(""); setConflict(false); reload();
  }
  function start(startIndex?: number) {
    const cards = queue.cards.slice(startIndex ?? 0);
    if (!cards.length) return;
    // Opening a particular card still starts there, even with shuffle enabled.
    setSession(selection.shuffle ? startIndex === undefined ? shuffled(cards) : [cards[0], ...shuffled(cards.slice(1))] : cards); setIndex(0); setFlipped(false);
    setSaveError(""); setConflict(false);
    window.scrollTo({ top: 0 });
  }
  const rate = useCallback(async (rating: Rating) => {
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
  }, [session, index, flipped, mode, conflict]);

  useEffect(() => {
    if (!session?.[index] || !flipped || mode !== "due" || saving || conflict) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      // Leave typing, number inputs, and custom form controls to the browser.
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='spinbutton'], [role='slider']")) return;
      const rating = /^[1-4]$/.test(event.key) ? ratings[Number(event.key) - 1] : undefined;
      if (!rating || lock.current) return;
      event.preventDefault();
      void rate(rating);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session, index, flipped, mode, saving, conflict, rate]);
  if (!ready) return <section className="mx-auto max-w-3xl"><h1 className="text-3xl font-semibold">Study</h1><p role="status" className="mt-6 text-gray-600">Opening your study session…</p></section>;
  if (session) {
    const card = session[index];
    return <section className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-4">
        <button disabled={saving} onClick={back} className={btnSecondary + disabled}>← Back to cards</button>
        {card && <div className="flex items-center gap-3"><Link href={`/decks/${card.deck_id}/edit?card=${card.id}&from=study`} className="text-sm font-semibold text-accent hover:underline">Edit card</Link><Link href={`/quiz/edit/${card.id}`} className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Edit quiz</Link></div>}
      </div>
      <div className="mt-7 flex items-end justify-between gap-4"><h1 className="text-3xl font-semibold">{mode === "due" ? "Review" : "Practice"}</h1><p role="status" aria-live="polite" className="text-sm text-gray-600">{card ? `Card ${index + 1} of ${session.length}` : "Complete"}</p></div>
      {card ? <>
        <Link href={`/decks/${card.deck_id}`} className="mt-3 inline-block text-sm text-gray-600 hover:text-accent">{card.deck_title} ↗</Link>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className="h-full bg-accent" style={{ width: `${index / session.length * 100}%` }} /></div>
        <button ref={cardRef} aria-describedby="study-card-content" aria-label={flipped ? "Answer. Flip to question" : "Question. Flip to answer"} disabled={saving} onClick={() => setFlipped(!flipped)} className="mt-6 block w-full rounded-2xl text-left">
          <Card className="flex min-h-72 flex-col justify-between p-7 sm:p-10"><span className="flex w-full items-center justify-between gap-3"><span className="text-sm font-semibold text-gray-600">{flipped ? "Answer" : "Question"}</span><Yogo expression={flipped ? "encouraging" : "thinking"} size={48} /></span><p id="study-card-content" className="my-9 whitespace-pre-wrap break-words text-center text-2xl leading-relaxed">{flipped ? card.answer : card.question}</p><span className="text-center text-sm text-accent">{flipped ? "Show question ↻" : "Show answer ↻"}</span></Card>
        </button>
        {!flipped ? <button disabled={saving} onClick={() => setFlipped(true)} className={`mt-5 w-full ${btnPrimary}`}>Show answer</button> : mode === "practice" ? <button className={`mt-5 w-full ${btnPrimary}`} onClick={() => { setFlipped(false); setIndex((value) => value + 1); }}>Next card →</button> : <div className="mt-6">
          <div className="grid grid-cols-4 gap-2">{ratings.map((rating, i) => <button key={rating} disabled={saving || conflict} aria-keyshortcuts={String(i + 1)} title={`${rating} (press ${i + 1})`} onClick={() => void rate(rating)} className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-2 py-3 text-center text-sm font-semibold transition-colors hover:border-accent hover:bg-blue-50 focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50 sm:text-base"><kbd aria-hidden="true" className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-1 font-sans text-xs text-gray-600">{i + 1}</kbd><span>{rating}</span></button>)}</div>
          <p className="mt-3 text-center text-xs text-gray-500">Press 1–4 to rate this card.</p>
        </div>}
        {saving && <p role="status" className="mt-3 text-sm">Saving review…</p>}
        {saveError && <div role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800"><p>{saveError}</p><p className="mt-2">{conflict ? "This card changed elsewhere. Reload the list to continue." : "Your place is saved. Try the rating again."}</p><button disabled={saving} onClick={back} className={`mt-3 ${btnSecondary}`}>Reload cards</button></div>}
      </> : <Card className="mt-6 p-8 text-center"><Yogo expression="celebrating" size={88} className="mx-auto mb-4" /><h2 ref={completedRef} tabIndex={-1} className="text-xl font-semibold">{mode === "due" ? "Reviews saved" : "Practice complete"}</h2><p className="mt-2 text-base text-gray-600">{mode === "due" ? "Your next review dates have been updated." : "Your review schedule has stayed the same."}</p><button onClick={back} className={`mt-5 ${btnPrimary}`}>Back to cards</button>{mode === "practice" && <button onClick={() => { setIndex(0); setFlipped(false); }} className={`ml-3 mt-5 ${btnSecondary}`}>Practice again</button>}</Card>}
    </section>;
  }
  function filter(action: () => void) { action(); reload(); }
  return <section className="mx-auto max-w-3xl">
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Study</h1><Link href="/quiz/history" className={btnSecondary}>Quiz history &amp; mistakes</Link></div>
    {resumeError && <div role="alert" className="mt-5 rounded-xl bg-amber-50 p-4 text-amber-900"><p>{resumeError}</p><button onClick={() => { window.history.replaceState(window.history.state, "", "/cards?resume=1"); setResumeRevision((value) => value + 1); }} className={`mt-3 ${btnSecondary}`}>Retry returning to study</button></div>}
    <div className="mt-7 grid gap-3 sm:grid-cols-2" role="group" aria-label="Study mode">
      <button aria-pressed={mode === "due"} onClick={() => filter(() => setMode("due"))} className={`rounded-xl border p-5 text-left ${mode === "due" ? "border-accent bg-blue-50 ring-1 ring-accent" : "border-gray-300 bg-white hover:border-accent"}`}><span className="flex items-center justify-between text-base font-semibold">Review due cards<span aria-hidden="true">{mode === "due" ? "●" : "○"}</span></span><span className="mt-2 block text-sm text-gray-600">New cards and cards due now. Ratings update your review schedule.</span></button>
      <button aria-pressed={mode === "practice"} onClick={() => filter(() => setMode("practice"))} className={`rounded-xl border p-5 text-left ${mode === "practice" ? "border-accent bg-blue-50 ring-1 ring-accent" : "border-gray-300 bg-white hover:border-accent"}`}><span className="flex items-center justify-between text-base font-semibold">Practice all cards<span aria-hidden="true">{mode === "practice" ? "●" : "○"}</span></span><span className="mt-2 block text-sm text-gray-600">Include cards that aren’t due. Your review schedule stays the same.</span></button>
    </div>
    <div className="mt-6"><StudyFocus selection={selection} decks={decks} tags={labels.map(label => label.name)} loading={loading} error={!!error} count={queue.total} onChange={next => filter(() => setSelection(next))} /></div>
    {loading ? <p role="status" className="mt-8">Loading cards…</p> : error ? <Card className="mt-6 p-5"><p role="alert" className="text-red-700">{error}</p><button onClick={reload} className={`mt-3 ${btnSecondary}`}>Try again</button></Card> : <>
      <div className="my-6 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-base">{queue.total} {mode === "due" ? "cards ready to review" : "cards to practice"}{queue.total > queue.cards.length && ` · Showing ${offset + 1}–${offset + queue.cards.length}`}</p><button disabled={!queue.cards.length} onClick={() => start()} className={btnPrimary + disabled}>{mode === "due" ? "Start review" : "Start practice"}{queue.cards.length > 0 && ` (${queue.cards.length})`} →</button></div>
      {quizCards.length > 0 && <div className="mb-6 flex flex-wrap items-center gap-3"><button disabled={!quizCards.some(c => quizSelection.includes(c.id))} className={btnSecondary + disabled} onClick={() => { const ids = quizCards.filter(c => quizSelection.includes(c.id)).map(c => c.id); router.push(`/quiz?cards=${ids.join(",")}&attempt=${crypto.randomUUID()}`); }}>Create quiz ({quizCards.filter(c => quizSelection.includes(c.id)).length}) →</button><button className="text-sm text-accent underline" onClick={() => setQuizSelection(quizCards.every(c => quizSelection.includes(c.id)) ? [] : quizCards.map(c => c.id))}>{quizCards.every(c => quizSelection.includes(c.id)) ? "Clear selection" : "Select all quiz-ready cards"}</button><p className="text-sm text-gray-600">Up to 100 cards · Uses saved quiz questions · No AI call when starting a quiz</p></div>}
      {!queue.cards.length && <Card className="p-6"><p>{mode === "due" ? "You’re caught up for these filters." : "No cards match these filters."}</p><div className="mt-4 flex flex-wrap gap-3">{mode === "due" && <button onClick={() => filter(() => setMode("practice"))} className={btnPrimary}>Practice these cards instead</button>}<Link href="/decks" className={btnSecondary}>Go to My Decks</Link></div></Card>}
      <div className="space-y-4">{queue.cards.map((card, cardIndex) => <Card key={card.id} className="overflow-hidden">
        <label className="flex items-center gap-2 px-5 pt-4 text-sm"><input disabled={!card.quiz_ready} type="checkbox" checked={quizSelection.includes(card.id)} onChange={e => setQuizSelection(ids => e.target.checked ? [...ids, card.id] : ids.filter(id => id !== card.id))} />{card.quiz_ready ? "Select for quiz" : "Use Edit quiz to add a question for this card"}</label>
        <button onClick={() => start(cardIndex)} className="group block w-full p-5 text-left hover:bg-blue-50/50 sm:p-6" aria-label={`${mode === "due" ? "Review" : "Practice"} card: ${card.question}`}>
          <span className="flex flex-wrap justify-between gap-2 text-sm text-gray-600"><span>{card.deck_title}</span><span>{card.status === "new" ? "New" : `${card.status === "due" ? "Due" : "Next review"}: ${new Date(card.due_at!).toLocaleDateString()}`}</span></span>
          <span className="mt-3 block whitespace-pre-wrap break-words text-lg font-semibold leading-7 group-hover:text-accent">{card.question}</span>
          <span className="mt-4 inline-block text-sm font-semibold text-accent">{mode === "due" ? "Review from this card" : "Practice from this card"} →</span>
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 pb-4 sm:px-6"><LabelEditor card={card} allLabels={labels} onSaved={reload} /><div className="mt-3 flex items-center gap-3"><Link href={`/decks/${card.deck_id}/edit?card=${card.id}`} className="text-sm font-semibold text-accent hover:underline">Edit card</Link><Link href={`/quiz/edit/${card.id}`} className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Edit quiz</Link></div></div>
      </Card>)}</div>
      {queue.total > selection.size && <div className="mt-6 flex flex-wrap items-center gap-3"><button disabled={offset === 0} className={btnSecondary + disabled} onClick={() => { setQuizSelection([]); setLoading(true); setOffset(Math.max(0, offset - selection.size)); }}>← Previous {selection.size}</button><button disabled={offset + queue.cards.length >= queue.total} className={btnSecondary + disabled} onClick={() => { setQuizSelection([]); setLoading(true); setOffset(offset + selection.size); }}>Next {selection.size} →</button></div>}
    </>}
  </section>;
}

export default function CardsPage() { return <RequireAuth><Study /></RequireAuth>; }
