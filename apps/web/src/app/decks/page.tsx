"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

type Item = { id: number; title: string; created_at: string; card_count: number };

function Library() {
  const [decks, setDecks] = useState<Item[]>([]);
  const [notes, setNotes] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [deckRes, noteRes] = await Promise.all([fetch("/api/decks"), fetch("/api/notes")]);
      if (!deckRes.ok || !noteRes.ok) throw new Error("Could not load your library. Please try again.");
      setDecks(await deckRes.json());
      setNotes(await noteRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your library.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    const file = body.get("file") as File;
    if (!file?.size || file.size > 5 * 1024 * 1024) {
      setUploadError("Choose a nonempty file up to 5 MB.");
      return;
    }
    setUploading(true);
    setUploadError("");
    setMessage("");
    try {
      const res = await fetch("/api/notes", { method: "POST", body });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        throw new Error(typeof result.detail === "string" ? result.detail : "Upload failed. Please try again.");
      }
      const note: Item = await res.json();
      setNotes((current) => [note, ...current]);
      form.reset();
      setShowUpload(false);
      setMessage("Notes saved to your library.");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const matches = (item: Item) => item.title.toLowerCase().includes(query.trim().toLowerCase());
  const visibleDecks = decks.filter(matches);
  const visibleNotes = notes.filter(matches);

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Decks</h1>
          <p className="mt-2 text-sm text-gray-500">Your notes, organized for your next study session.</p>
        </div>
        <button type="button" onClick={() => setShowUpload(!showUpload)} aria-expanded={showUpload} aria-controls="upload-notes" className={btnPrimary}>
          {showUpload ? "Close upload" : "+ Upload notes"}
        </button>
      </div>

      {showUpload && (
        <Card className="mt-6 p-5">
          <form id="upload-notes" onSubmit={upload} className="space-y-4">
            <h2 className="font-semibold">Upload notes</h2>
            <p className="text-sm text-gray-500">Save your class materials here. Flashcard generation is not connected to this upload yet.</p>
            <div>
              <label htmlFor="note-title" className="text-sm font-medium">Title</label>
              <input id="note-title" name="title" required maxLength={200} disabled={uploading} placeholder="e.g. Biology — Chapter 4" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-5">
              <label htmlFor="note-file" className="block text-sm font-medium">Choose your notes</label>
              <p id="file-help" className="mt-1 text-xs text-gray-500">PDF, DOCX, or TXT · Up to 5 MB</p>
              <input id="note-file" name="file" type="file" accept=".pdf,.docx,.txt" required disabled={uploading} aria-describedby="file-help" className="mt-3 block w-full text-sm" />
            </div>
            {uploadError && <p role="alert" className="text-sm text-red-700">{uploadError}</p>}
            <button disabled={uploading} className={`${btnPrimary} disabled:opacity-50`}>{uploading ? "Uploading…" : "Save notes"}</button>
          </form>
        </Card>
      )}
      <p role="status" className="mt-4 text-sm text-green-800">{message}</p>
      <label htmlFor="deck-search" className="sr-only">Search decks and notes</label>
      <input id="deck-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your decks and notes…" className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm" />

      {loading ? <p role="status" className="mt-8 text-sm text-gray-500">Loading your library…</p> : error ? (
        <Card className="mt-6 p-6"><p role="alert" className="text-sm text-red-700">{error}</p><button onClick={load} className={`mt-4 ${btnSecondary}`}>Try again</button></Card>
      ) : (
        <>
          <h2 className="mb-4 mt-8 font-semibold">Saved decks <span className="font-normal text-gray-500">({decks.length})</span></h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleDecks.map((deck) => (
              <Card key={deck.id} className="flex flex-col p-5">
                <span aria-hidden="true" className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-xl text-accent">▤</span>
                <h3 className="break-words font-semibold">{deck.title}</h3>
                <p className="mt-1 text-sm text-gray-500">{deck.card_count} {deck.card_count === 1 ? "card" : "cards"}</p>
                <p className="mb-5 mt-2 text-xs text-gray-500">Added {new Date(deck.created_at).toLocaleDateString()}</p>
                {deck.card_count > 0 ? <Link href={`/cards?deck=${deck.id}`} className="mt-auto border-t border-gray-100 pt-4 text-sm font-medium text-accent hover:underline">Study deck →</Link> : <p className="mt-auto text-sm text-gray-500">No cards yet</p>}
              </Card>
            ))}
          </div>
          {!visibleDecks.length && <Card className="p-6 text-sm text-gray-500">{query ? "No decks match your search." : "No decks yet. Your saved flashcard decks will appear here."}</Card>}
          <h2 className="mb-4 mt-8 font-semibold">Uploaded notes <span className="font-normal text-gray-500">({notes.length})</span></h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleNotes.map((note) => (
              <Card key={note.id} className="p-5">
                <h3 className="break-words font-semibold">{note.title}</h3>
                <p className="mt-2 text-xs text-gray-500">Uploaded {new Date(note.created_at).toLocaleDateString()}</p>
                <a href={`/api/notes/${note.id}/download`} className="mt-5 block border-t border-gray-100 pt-4 text-sm font-medium text-accent hover:underline">Download notes →</a>
              </Card>
            ))}
          </div>
          {!visibleNotes.length && <Card className="p-6 text-sm text-gray-500">{query ? "No notes match your search." : "Upload your first notes to keep them in your library."}</Card>}
        </>
      )}
    </section>
  );
}

export default function DecksPage() {
  return <RequireAuth><Library /></RequireAuth>;
}
