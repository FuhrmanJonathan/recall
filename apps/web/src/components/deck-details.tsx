"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

type Flashcard = { id: number; question: string; answer: string; needs_review: boolean };
type Deck = { id: number; title: string; flashcards: Flashcard[] };

function Details({ deckId }: { deckId: string }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/decks/${encodeURIComponent(deckId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "This deck could not be found." : "Could not open this deck. Please try again.");
        const data: Deck = await res.json();
        if (!controller.signal.aborted) setDeck(data);
      })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not open this deck."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [deckId, revision]);

  if (loading) return <p role="status" className="py-20 text-center text-gray-600">Opening your deck…</p>;
  if (!deck || error) return <Card className="p-8"><p role="alert" className="text-red-800">{error}</p><div className="mt-5 flex gap-3"><button onClick={() => setRevision((v) => v + 1)} className={btnPrimary}>Try again</button><Link href="/decks" className={btnSecondary}>My Decks</Link></div></Card>;

  const flagged = deck.flashcards.filter((card) => card.needs_review).length;
  const cards = deck.flashcards.map((card, index) => ({ ...card, index })).filter((card) =>
    (!flaggedOnly || card.needs_review) && `${card.question} ${card.answer}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  return <section>
    <Link href="/decks" className="text-sm font-medium text-gray-600 hover:text-accent">← All decks</Link>
    <div className="mt-6 rounded-2xl border border-blue-100 bg-[#edf2ff] p-6 sm:p-9">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-2xl"><h1 className="mt-3 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{deck.title}</h1><p className="mt-4 text-base text-gray-700">{deck.flashcards.length} flashcards {flagged > 0 && <><span className="mx-2 text-gray-500">·</span>{flagged} need checking</>}</p></div>
        <div className="flex flex-wrap gap-3"><Link href={`/decks/${deck.id}/edit`} className={btnSecondary}>Edit deck</Link>{deck.flashcards.length > 0 && <Link href={`/cards?deck=${deck.id}`} className={btnPrimary}>Study this deck →</Link>}</div>
      </div>
    </div>
    <div className="mb-5 mt-10 flex flex-wrap items-end justify-between gap-4">
      <div><h2 className="text-2xl font-semibold tracking-tight">Cards in this deck</h2></div>
      <Link href={`/decks/${deck.id}/edit?add=1`} className={btnSecondary}>+ Add a card</Link>
    </div>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <label className="w-full sm:max-w-sm"><span className="sr-only">Search this deck</span><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions and answers" className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base" /></label>
      <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} className="h-4 w-4 accent-blue-700" />Needs checking ({flagged})</label>
    </div>
    <div className="space-y-4">
      {cards.map((card) => <article key={card.id} className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-3"><span className="text-sm font-semibold text-gray-600">Card {String(card.index + 1).padStart(2, "0")}</span>{card.needs_review && <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-900">Needs checking</span>}</div>
        <div className="grid gap-6 md:grid-cols-2 md:gap-10">
          <div><p className="mb-2 text-sm font-semibold text-accent">Question</p><h3 className="whitespace-pre-wrap break-words text-lg font-semibold leading-8">{card.question}</h3></div>
          <div className="border-t border-gray-100 pt-5 md:border-l md:border-t-0 md:pl-8 md:pt-0"><p className="mb-2 text-sm font-semibold text-gray-600">Answer</p><p className="whitespace-pre-wrap break-words text-base leading-8 text-gray-700">{card.answer}</p></div>
        </div>
        <div className="mt-5 border-t border-gray-100 pt-4"><Link aria-label={`Edit card ${card.index + 1}`} href={`/decks/${deck.id}/edit?card=${card.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-accent hover:underline">Edit card <span aria-hidden="true">↗</span></Link></div>
      </article>)}
      {!cards.length && <Card className="p-10 text-center"><h3 className="text-lg font-semibold">{deck.flashcards.length ? "No matching cards" : "This deck is ready for its first card"}</h3><p className="mt-2 text-gray-600">{deck.flashcards.length ? "Try another search or turn off the review filter." : "Add a question and answer to get started."}</p></Card>}
    </div>
  </section>;
}

export default function DeckDetails({ deckId }: { deckId: string }) {
  return <RequireAuth><Details key={deckId} deckId={deckId} /></RequireAuth>;
}
