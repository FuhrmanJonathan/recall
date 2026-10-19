"use client";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary } from "@/components/ui";

const API = "/api";
type CardData = { id: number; question: string; answer: string };
type Rating = "Again" | "Hard" | "Good" | "Easy";

const ratings: { label: Rating; className: string }[] = [
  { label: "Again", className: "hover:border-red-700 hover:text-red-800" },
  { label: "Hard", className: "hover:border-amber-700 hover:text-amber-800" },
  { label: "Good", className: "hover:border-sky-700 hover:text-sky-800" },
  { label: "Easy", className: "hover:border-accent hover:text-accent" },
];

function Study() {
  const [cards, setCards] = useState<CardData[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const done = index >= cards.length;
  const card = cards[index];

  useEffect(() => {
    async function load() {
      try {
        const decksRes = await fetch(`${API}/decks`, { credentials: "include" });
        if (!decksRes.ok) throw new Error("Could not load decks");
        const decks = await decksRes.json();

        if (decks.length) {
          const deckRes = await fetch(`${API}/decks/${decks[0].id}`, { credentials: "include" });
          if (!deckRes.ok) throw new Error("Could not load deck");
          const deck = await deckRes.json();
          setTitle(deck.title);
          setCards(deck.cards);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function rate(rating: Rating) {
    if (!card) return;
    const flashcardId = card.id;

    // advance immediately so the UI feels instant
    setFlipped(false);
    setIndex((i) => i + 1);

    try {
      const res = await fetch(`${API}/reviews`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flashcard_id: flashcardId, rating }),
      });
      if (!res.ok) throw new Error("Review not saved");
    } catch (e) {
      console.error(e); // optionally surface this in the UI
    }
  }

  function restart() {
    setFlipped(false);
    setIndex(0);
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p>{error}</p>;
  if (cards.length === 0) return <p>No cards yet.</p>;

  return (
    <section className="mx-auto max-w-xl">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <span className="text-sm text-ink/60">
          {done ? "Done" : `${index + 1} of ${cards.length}`}
        </span>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${(Math.min(index, cards.length) / cards.length) * 100}%` }}
        />
      </div>

      {done ? (
        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-10 shadow-sm text-center">
          <p className="text-lg font-semibold">Deck finished</p>
          <p className="mt-1 text-sm text-ink/60">Nice work. Come back when cards are due.</p>
          <button onClick={restart} className={`mt-5 text-sm ${btnPrimary}`}>
            Start over
          </button>
        </div>
      ) : (
        <>
          <button onClick={() => setFlipped(!flipped)} className="mt-8 block w-full text-left">
            <Card className="relative h-72 w-full transition hover:shadow-md">
              <span className="absolute left-5 top-4 text-xs font-medium text-gray-400">
                {flipped ? "Answer" : "Question"}
              </span>
              <span className="flex h-full items-center justify-center px-8 text-center">
                <span className={flipped ? "text-xl leading-7 text-ink/80" : "text-3xl font-semibold"}>
                  {flipped ? card.answer : card.question}
                </span>
              </span>
              {!flipped && (
                <span className="absolute inset-x-0 bottom-3 text-center text-xs text-ink/40">
                  Click to flip
                </span>
              )}
            </Card>
          </button>

          <div className="mt-4 grid grid-cols-4 gap-2">
            {ratings.map((r) => (
              <button
                key={r.label}
                onClick={() => rate(r.label)}
                disabled={!flipped}
                className={`rounded-lg border border-gray-200 bg-white py-2 text-sm font-medium transition disabled:opacity-40 ${r.className}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default function CardsPage() {
  return (
    <RequireAuth>
      <Study />
    </RequireAuth>
  );
}