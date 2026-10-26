"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth";
import { btnPrimary, btnSecondary } from "@/components/ui";

const steps = [
  { number: "01", title: "Bring your notes.", text: "Upload a PDF, document, or photo of your notes. Choose a topic you want to focus on." },
  { number: "02", title: "Make the cards yours.", text: "Review your generated deck. Refine a question, fix an answer, or add something important." },
  { number: "03", title: "Remember a little more.", text: "Review the cards that are due, or practice freely. Recall adjusts your next review as you learn." },
];

export default function Home() {
  const { user } = useAuth();
  return <>
    <section className="grid items-center gap-12 py-8 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
      <div>

        <h1 className="mt-6 max-w-xl text-5xl font-semibold leading-[1.08] tracking-[-.045em] sm:text-6xl lg:text-7xl">Less cramming.<br /><span className="text-accent">More recalling.</span></h1>
        <p className="mt-7 max-w-lg text-lg leading-8 text-gray-600">Turn your notes into flashcards you actually want to study. Make them yours, then build a habit that sticks.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href={user ? "/decks" : "/signup"} className={btnPrimary}>{user ? "Open my decks" : "Create your first deck"}<span className="ml-3">→</span></Link><Link href={user ? "/cards" : "/login"} className={btnSecondary}>{user ? "Start studying" : "I already have an account"}</Link></div>
        <p className="mt-5 text-sm text-gray-600">Your notes. Your words. Your pace.</p>
      </div>
      <div className="relative rounded-3xl bg-[#e9effd] p-6 sm:p-10" aria-label="Example flashcard">
        <div aria-hidden="true" className="absolute inset-x-12 bottom-6 top-14 rotate-[-5deg] rounded-2xl border border-blue-200 bg-[#dbe6fc]" />
        <div className="relative rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_16px_40px_-20px_rgba(30,50,90,.3)] sm:p-8">
          <div className="flex items-center justify-between border-b border-gray-100 pb-5 text-sm"><span className="font-semibold text-gray-700">Biology · Cell essentials</span><span className="text-gray-600">01 / 12</span></div>
          <p className="mt-8 text-sm font-semibold text-accent">Question</p><p className="mt-3 text-2xl font-semibold leading-9 tracking-tight">What gives a cell the energy to do its thing?</p>
          <div className="my-7 h-px bg-gray-100" /><p className="text-sm font-semibold text-gray-600">Answer</p><p className="mt-3 text-base leading-7 text-gray-700">Mitochondria produce ATP, the energy that powers most cellular processes.</p>
          <div className="mt-8 flex items-center gap-2 text-sm text-emerald-800"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50" aria-hidden="true">✓</span>One more thing you’ll remember.</div>
        </div>
      </div>
    </section>
    <section className="mt-8 border-t border-gray-200 pt-12 sm:mt-12 sm:pt-16">
      <div className="flex flex-wrap items-end justify-between gap-4"><h2 className="max-w-lg text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Good notes deserve<br />a second life.</h2><p className="max-w-sm text-base leading-7 text-gray-600">From a folder full of notes to a manageable daily routine.</p></div>
      <div className="mt-10 grid gap-8 md:grid-cols-3">{steps.map((step) => <div key={step.number} className="border-t-2 border-blue-200 pt-5"><p className="text-sm font-semibold text-accent">{step.number}</p><h3 className="mt-5 text-xl font-semibold">{step.title}</h3><p className="mt-3 text-base leading-7 text-gray-600">{step.text}</p></div>)}</div>
    </section>
    <footer className="mt-20 flex flex-wrap justify-between gap-3 border-t border-gray-200 py-7 text-sm text-gray-600"><span className="font-semibold text-ink">Recall</span></footer>
  </>;
}
