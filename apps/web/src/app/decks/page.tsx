"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLeaveGuard } from "@/components/use-leave-guard";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

type Item = { id: number; title: string; created_at: string; card_count: number; flagged_count: number };
type Mode = "manual" | "generate" | "notes";
type GenerationStatus = { configured: boolean; images_available: boolean };
const field = "mt-2 block w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base";

function Library() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("manual");
  const [decks, setDecks] = useState<Item[]>([]);
  const [notes, setNotes] = useState<Item[]>([]);
  const [generation, setGeneration] = useState<GenerationStatus | null>(null);
  const [generationError, setGenerationError] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [message, setMessage] = useState("");
  useLeaveGuard(false, busy);
  const lock = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  async function loadGeneration() {
    setGenerationError(false);
    try {
      const response = await fetch("/api/flashcards/status", { cache: "no-store" });
      if (!response.ok) throw new Error();
      setGeneration(await response.json());
    } catch { setGenerationError(true); }
  }
  async function load() {
    setLoading(true); setError("");
    try {
      const [deckRes, noteRes] = await Promise.all([fetch("/api/decks", { cache: "no-store" }), fetch("/api/notes", { cache: "no-store" })]);
      if (!deckRes.ok || !noteRes.ok) throw new Error("Could not load your library. Your saved decks are safe. Please try again.");
      const [nextDecks, nextNotes] = await Promise.all([deckRes.json(), noteRes.json()]);
      setDecks(nextDecks); setNotes(nextNotes);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load your library."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); void loadGeneration(); }, []);
  useEffect(() => { if (open) titleRef.current?.focus(); }, [open]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = event.currentTarget;
    const body = new FormData(form);
    const title = String(body.get("title") ?? "").trim();
    if (!title) { setCreateError("Enter a title for your deck or notes."); titleRef.current?.focus(); return; }
    if (mode === "generate" && !generation?.configured) return;
    if (mode !== "manual") {
      const file = body.get("file") as File;
      const limit = mode === "notes" ? 5 * 1024 * 1024 : /\.(pdf|docx)$/i.test(file?.name ?? "") ? 20_000_000 : /\.(txt|md)$/i.test(file?.name ?? "") ? 1_000_000 : 10_000_000;
      if (!file?.size || file.size > limit) { setCreateError("Choose a nonempty file within the size limit shown below."); return; }
    }
    lock.current = true; setBusy(true); setCreateError(""); setMessage("");
    try {
      const res = await fetch(mode === "manual" ? "/api/decks" : mode === "generate" ? "/api/flashcards/generate" : "/api/notes", mode === "manual" ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }),
      } : { method: "POST", body });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) throw new Error("Your session expired. Log in again in another tab, then retry; your form is still here.");
        if (mode === "generate" && res.status >= 500) throw new Error("Could not generate cards right now. Your file is still selected. Try again, or choose Write cards to create your deck yourself.");
        throw new Error(typeof result.detail === "string" ? result.detail : "Could not save. Your form is still here; please try again.");
      }
      if (mode !== "notes") { router.push(`/decks/${result.id}/edit${mode === "manual" ? "?add=1" : ""}`); return; }
      setNotes((current) => [result, ...current]); form.reset(); setOpen(false);
      setMessage("Notes saved. This keeps the original file; it does not create flashcards.");
    } catch (e) { setCreateError(e instanceof Error ? e.message : "Could not save. Please try again."); }
    finally { lock.current = false; setBusy(false); }
  }

  const matches = (item: Item) => item.title.toLowerCase().includes(query.trim().toLowerCase());
  const visibleDecks = decks.filter(matches);
  const visibleNotes = notes.filter(matches);
  return <section>
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-4xl font-semibold tracking-tight">My Decks</h1><button disabled={busy} type="button" onClick={() => { setOpen(!open); setCreateError(""); }} aria-expanded={open} aria-controls="create-deck" className={open ? btnSecondary : btnPrimary}>{open ? "Cancel" : "+ Create a deck"}</button></div>
    {open && <Card className="mt-6 p-5 sm:p-7">
      <form id="create-deck" onSubmit={create} className="space-y-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="How to create cards">{([{ value: "manual", label: "Write cards" }, { value: "generate", label: "Generate from notes" }, { value: "notes", label: "Save notes only" }] as { value: Mode; label: string }[]).map((option) => <button key={option.value} type="button" disabled={busy} aria-pressed={mode === option.value} onClick={() => { setMode(option.value); setCreateError(""); }} className={mode === option.value ? btnPrimary : btnSecondary}>{option.label}</button>)}</div>
        {mode === "manual" ? <p className="text-base text-gray-600">Name your deck, then add questions and answers in the editor.</p> : mode === "notes" ? <p className="text-base text-gray-600">Keep the original file in your library. This does not create flashcards.</p> : generationError ? <div role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">Could not check whether generation is available. <button type="button" onClick={() => void loadGeneration()} className="font-semibold underline">Check again</button>. You can still write cards yourself.</div> : !generation ? <p role="status" className="text-gray-600">Checking generation availability…</p> : !generation.configured ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">AI generation isn’t configured on this server yet. Choose <button type="button" onClick={() => setMode("manual")} className="font-semibold underline">Write cards</button> to make a deck now, or save your notes for later.</div> : <p className="text-base text-gray-600">Upload notes to generate a deck. You’ll review and edit the cards before studying.</p>}
        <div><label htmlFor="note-title" className="text-sm font-semibold">{mode === "notes" ? "Notes title" : "Deck title"}</label><input ref={titleRef} id="note-title" name="title" required maxLength={200} disabled={busy} placeholder="e.g. Biology — Chapter 4" className={field} /></div>
        {mode !== "manual" && (mode === "notes" || generation?.configured) && <>
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-5"><label htmlFor="note-file" className="block text-sm font-semibold">Choose your notes</label><p id="file-help" className="mt-2 text-sm text-gray-600">{mode === "notes" ? "PDF, DOCX, or TXT · Up to 5 MB" : `PDF/DOCX up to 20 MB · TXT/MD up to 1 MB${generation?.images_available ? " · JPG/PNG/WEBP up to 10 MB" : " · Photos aren’t enabled here"}`}</p><input id="note-file" name="file" type="file" accept={mode === "notes" ? ".pdf,.docx,.txt" : generation?.images_available ? ".pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp" : ".pdf,.docx,.txt,.md"} required disabled={busy} aria-describedby="file-help" className="mt-3 block w-full text-sm" /></div>
          {mode === "generate" && <div><label htmlFor="generation-focus" className="text-sm font-semibold">Topic to focus on (optional)</label><input id="generation-focus" name="focus" maxLength={300} disabled={busy} placeholder="e.g. DNA replication" className={field} /></div>}
        </>}
        {createError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{createError}</p>}
        <button disabled={busy || (mode === "generate" && !generation?.configured)} className={btnPrimary}>{busy ? mode === "generate" ? "Generating your cards…" : "Saving…" : mode === "manual" ? "Create deck & add cards →" : mode === "notes" ? "Save notes" : "Generate & review cards →"}</button>
        {busy && <p role="status" className="text-sm text-gray-600">{mode === "generate" ? "This may take a little while. Keep this page open; your deck will open when it’s ready." : "Keep this page open while your changes are saved."}</p>}
      </form>
    </Card>}
    {message && <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
    <label htmlFor="deck-search" className="sr-only">Search decks and notes</label><input id="deck-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your decks and notes…" className="mt-7 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base" />
    {loading ? <p role="status" className="mt-8 text-gray-600">Loading your library…</p> : error ? <Card className="mt-6 p-6"><p role="alert" className="text-red-800">{error}</p><button onClick={load} className={`mt-4 ${btnSecondary}`}>Try again</button></Card> : <>
      <h2 className="mb-4 mt-8 text-xl font-semibold">Decks <span className="font-normal text-gray-600">({visibleDecks.length})</span></h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleDecks.map((deck) => <Card key={deck.id} className="flex flex-col overflow-hidden">
        <Link href={`/decks/${deck.id}`} className="group block flex-1 p-6 hover:bg-blue-50/40"><span aria-hidden="true" className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-xl text-accent">▤</span><h3 className="break-words text-xl font-semibold leading-7 group-hover:text-accent">{deck.title}</h3><p className="mt-2 text-sm text-gray-600">{deck.card_count} {deck.card_count === 1 ? "card" : "cards"}{deck.flagged_count > 0 && ` · ${deck.flagged_count} need checking`}</p><p className="mt-5 text-sm font-semibold text-accent">Open deck →</p></Link>
        {deck.card_count > 0 && <div className="border-t border-gray-100 px-6 py-4"><Link href={`/cards?deck=${deck.id}`} className="text-sm font-semibold text-gray-700 hover:text-accent">Study this deck →</Link></div>}
      </Card>)}</div>
      {!visibleDecks.length && <Card className="p-7"><p className="text-gray-600">{query ? "No decks match this search." : "Create your first deck to start adding cards."}</p><button onClick={() => query ? setQuery("") : setOpen(true)} className={`mt-4 ${btnSecondary}`}>{query ? "Clear search" : "Create a deck"}</button></Card>}
      <h2 className="mb-4 mt-9 text-xl font-semibold">Saved notes <span className="font-normal text-gray-600">({visibleNotes.length})</span></h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleNotes.map((note) => <Card key={note.id} className="p-6"><h3 className="break-words text-lg font-semibold">{note.title}</h3><p className="mt-2 text-sm text-gray-600">Original file · {new Date(note.created_at).toLocaleDateString()}</p><a href={`/api/notes/${note.id}/download`} className="mt-5 block border-t border-gray-100 pt-4 text-sm font-semibold text-accent hover:underline">Download notes →</a></Card>)}</div>
      {!visibleNotes.length && <p className="text-base text-gray-600">{query ? "No notes match this search." : "No saved notes yet. Choose Save notes only when creating a deck to keep an original file here."}</p>}
    </>}
  </section>;
}

export default function DecksPage() { return <RequireAuth><Library /></RequireAuth>; }
