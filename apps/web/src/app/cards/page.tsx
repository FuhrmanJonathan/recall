"use client";
import { useState } from "react";

export default function CardsPage() {
  const [flipped, setFlipped] = useState(false);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-6">
      <h1>Flashcard Set</h1>
      <h2>number of terms left * creator name</h2>
      <div
        onClick={() => setFlipped(!flipped)}
        className="flex h-64 cursor-pointer items-center justify-center rounded-xl border bg-white text-3xl text-black"
      >
        {flipped ? "term" : "definition"} 
        {/* need to input data */}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <button className="rounded bg-yellow-600 p-2 text-white">Again</button>
        <button className="rounded bg-purple-500 p-2 text-white">Hard</button>
        <button className="rounded bg-blue-600 p-2 text-white">Good</button>
        <button className="rounded bg-green-600 p-2 text-white">Easy</button>
      </div>
    </main>
  );
}