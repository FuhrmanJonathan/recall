"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth";
import { Card, btnPrimary, btnSecondary } from "@/components/ui";

const features = [
  { title: "Upload anything", text: "Photos of handwritten notes, typed notes, PDFs and lecture slides. Recall reads the text for you, handwriting included." },
  { title: "Cards written for you", text: "Recall picks out the key terms and ideas and turns them into question and answer cards. You can edit any card before you study it." },
  { title: "Spaced repetition", text: "Rate each card Again, Hard, Good or Easy. Cards you know come back less often and cards you miss come back sooner." },
  { title: "A study plan", text: "Tell Recall when your exam is and it spreads your reviews across the days before it, so you aren't cramming the night before." },
  { title: "Anki and Quizlet", text: "Bring in decks you already have from Anki or Quizlet, and export your Recall decks back out whenever you want." },
  { title: "Phone or laptop", text: "Recall runs in the browser, so you can make cards on your laptop and review them on your phone between classes." },
];

const uses = [
  "Weekly lecture notes for any class",
  "Definitions and diagrams for biology and chemistry",
  "Vocabulary for a language course",
  "Formulas and theorems for math and physics",
  "Dates, people and events for history",
  "Big exams like the MCAT, LSAT or GRE",
];

const steps = [
  { title: "Upload your notes", text: "Drop in a photo, PDF or slide deck from class." },
  { title: "Check your cards", text: "Look over the cards Recall made and fix anything you want." },
  { title: "Study a little each day", text: "Open Recall, review what's due, and you're done." },
];

export default function Home() {
  const { user } = useAuth();

  const startButton = user ? (
    <Link href="/dashboard" className={btnPrimary}>Go to dashboard</Link>
  ) : (
    <Link href="/signup" className={btnPrimary}>Get started for free</Link>
  );

  return (
    <>
      {/* Intro */}
      <section className="grid items-center gap-12 pt-6 md:grid-cols-2 md:pt-12">
        <div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Your notes, turned into flashcards.
          </h1>
          <p className="mt-4 max-w-md text-lg text-gray-600">
            Upload what you wrote in class. Recall makes the flashcards, then tells you which ones to
            study each day so you actually remember them on test day.
          </p>
          <div className="mt-8 flex gap-3">
            {startButton}
            {!user && <Link href="/login" className={btnSecondary}>Log in</Link>}
          </div>
        </div>

        <Card className="mx-auto w-full max-w-sm p-5">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Biology 101</span>
            <span>4 of 20</span>
          </div>
          <div className="mt-3 h-1 rounded-full bg-gray-100">
            <div className="h-full w-1/5 rounded-full bg-accent" />
          </div>
          <div className="mt-5 flex h-36 items-center justify-center rounded-lg bg-gray-50 text-2xl font-semibold">
            Mitochondria
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs text-gray-600">
            {["Again", "Hard", "Good", "Easy"].map((label) => (
              <span key={label} className="rounded-md border border-gray-200 py-1.5">{label}</span>
            ))}
          </div>
        </Card>
      </section>

      {/* Why it works */}
      <section className="mt-24 max-w-3xl">
        <h2 className="text-2xl font-bold tracking-tight">Remembering things just got easier</h2>
        <p className="mt-4 text-gray-600">
          Rereading your notes feels productive, but most of it is gone a week later. What actually
          works is testing yourself, and doing it again right before you&apos;d forget. That&apos;s called
          spaced repetition, and it&apos;s how med students and language learners get through huge
          amounts of material.
        </p>
        <p className="mt-4 text-gray-600">
          The hard part has always been making the cards. Recall does that part for you, straight from
          the notes you already have, so you can spend your time studying instead of typing.
        </p>
      </section>

      {/* Features */}
      <section className="mt-16">
        <h2 className="text-2xl font-bold tracking-tight">What Recall does</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title} className="p-5">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600">{f.text}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Uses */}
      <section className="mt-16 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">What can I use it for?</h2>
          <p className="mt-4 text-gray-600">
            If it&apos;s in your notes and you need to know it for a test, Recall can make cards from it.
            Students use it for things like:
          </p>
        </div>
        <ul className="space-y-3">
          {uses.map((use) => (
            <li key={use} className="flex gap-3 text-gray-700">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              {use}
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section className="mt-16">
        <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title}>
              <Card className="h-full p-5">
                <p className="text-sm font-medium text-accent">Step {i + 1}</p>
                <h3 className="mt-1 font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-gray-600">{step.text}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* Closing call to action */}
      <section className="mt-16 rounded-xl bg-gray-900 px-6 py-10 text-center text-white sm:px-10">
        <h2 className="text-2xl font-bold tracking-tight">Start your first deck</h2>
        <p className="mt-2 text-gray-300">It takes about a minute to go from notes to flashcards.</p>
        <div className="mt-6">{startButton}</div>
      </section>

      <footer className="mt-16 border-t border-gray-200 pb-2 pt-6 text-sm text-gray-500">
        Recall is built by the Oogways for CS 370 at Emory University.
      </footer>
    </>
  );
}
