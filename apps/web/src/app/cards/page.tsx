"use client";
import { useState } from "react";
import { RequireAuth } from "@/components/auth";
import { Card, btnPrimary } from "@/components/ui";

// Placeholder cards until the page loads a real deck from the backend.
const sampleCards = [
  { term: "Mitochondria", definition: "The organelle that produces most of the cell's energy (ATP)." },
  { term: "Photosynthesis", definition: "How plants turn light, water and CO₂ into glucose and oxygen." },
  { term: "Osmosis", definition: "Movement of water across a membrane toward higher solute concentration." },
];

const ratings = [
  { label: "Again", className: "hover:border-red-700 hover:text-red-800" },
  { label: "Hard", className: "hover:border-amber-700 hover:text-amber-800" },
  { label: "Good", className: "hover:border-sky-700 hover:text-sky-800" },
  { label: "Easy", className: "hover:border-accent hover:text-accent" },
];

function Study() {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const done = index >= sampleCards.length;
  const card = sampleCards[index];

  function next() {
    setFlipped(false);
    setIndex(index + 1);
  }

  return (
    <section className="mx-auto max-w-xl">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Sample deck</h1>
        <span className="text-sm text-ink/60">
          {done ? "Done" : `${index + 1} of ${sampleCards.length}`}
        </span>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${(Math.min(index, sampleCards.length) / sampleCards.length) * 100}%` }}
        />
      </div>

      {done ? (
        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-10 shadow-sm text-center">
          <p className="text-lg font-semibold">Deck finished</p>
          <p className="mt-1 text-sm text-ink/60">Nice work. Come back when cards are due.</p>
          <button
            onClick={() => setIndex(0)}
            className={`mt-5 text-sm ${btnPrimary}`}
          >
            Start over
          </button>
        </div>
      ) : (
        <>
          <button onClick={() => setFlipped(!flipped)} className="mt-8 block w-full text-left">
            <Card className="relative h-72 w-full transition hover:shadow-md">
              <span className="absolute left-5 top-4 text-xs font-medium text-gray-400">
                {flipped ? "Definition" : "Term"}
              </span>
              <span className="flex h-full items-center justify-center px-8 text-center">
                <span className={flipped ? "text-xl leading-7 text-ink/80" : "text-3xl font-semibold"}>
                  {flipped ? card.definition : card.term}
                </span>
              </span>
              {!flipped && (
                <span className="absolute inset-x-0 bottom-3 text-center text-xs text-ink/40">Click to flip</span>
              )}
            </Card>
          </button>

          <div className="mt-4 grid grid-cols-4 gap-2">
            {ratings.map((rating) => (
              <button
                key={rating.label}
                onClick={next}
                disabled={!flipped}
                className={`rounded-lg border border-gray-200 bg-white py-2 text-sm font-medium transition disabled:opacity-40 ${rating.className}`}
              >
                {rating.label}
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
