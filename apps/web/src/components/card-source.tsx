"use client";

import { useEffect, useRef, useState } from "react";
import Yogo from "@/components/yogo";
import { btnSecondary } from "@/components/ui";

export type CardSource = {
  card_id: number;
  deck_id: number;
  deck_title: string;
  question: string;
  answer: string;
  available: boolean;
  kind: "text" | "docx" | "pdf" | "image" | null;
  filename: string;
  excerpt: string | null;
  page: number | null;
  match: "excerpt" | "guess" | null;
  context: { before: string; match: string; after: string; more_before: boolean; more_after: boolean } | null;
  file_url: string | null;
};

/** "Where is this from?" button that opens the passage of the notes a card was made from. */
export function SourceButton({ cardId, className = "", children }: { cardId: number; className?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={opener} type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
      className={className || "inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 transition-colors hover:bg-amber-100"}>
      {children ?? <><BookIcon />Where is this in my notes?</>}
    </button>
    {open && <SourcePanel cardId={cardId} onClose={() => { setOpen(false); opener.current?.focus(); }} />}
  </>;
}

function BookIcon() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4.5C3 3.7 3.7 3 4.5 3H9a1 1 0 0 1 1 1v12.5a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 1 3 13.5z" />
    <path d="M17 4.5c0-.8-.7-1.5-1.5-1.5H11a1 1 0 0 0-1 1v12.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 0 1.5-1.5z" />
  </svg>;
}

export function SourcePanel({ cardId, onClose }: { cardId: number; onClose: () => void }) {
  const [source, setSource] = useState<CardSource | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setSource(null); setError("");
    fetch(`/api/flashcards/${cardId}/source`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (res.status === 404) throw new Error("This card is no longer available.");
        if (!res.ok) throw new Error("Could not load your notes. Try again.");
        setSource(await res.json());
      })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load your notes."); });
    return () => controller.abort();
  }, [cardId, revision]);

  // Focus the panel, close on Escape, and keep the page behind it from scrolling.
  useEffect(() => {
    dialog.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") { event.preventDefault(); close.current(); } }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); document.body.style.overflow = overflow; };
  }, []);

  // Scroll only the notes box, so the card recap above it stays in view.
  useEffect(() => {
    const el = mark.current, box = el?.closest<HTMLElement>("[data-notes]");
    if (el && box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3;
  }, [source]);

  return <div className="fixed inset-0 z-50 flex justify-end">
    <button type="button" aria-label="Close notes" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-slate-900/30" />
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="source-title" tabIndex={-1}
      className="relative flex h-full w-full max-w-xl flex-col bg-white text-left shadow-2xl outline-none">
      <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">From your notes</p>
          <h2 id="source-title" className="mt-1 text-xl font-semibold">Where this card came from</h2>
          {source?.filename && <p className="mt-1 truncate text-sm text-gray-600">{source.filename}{source.page ? ` · page ${source.page}` : ""}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-2xl leading-none text-gray-500 hover:bg-gray-100">×</button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {error ? <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800"><p>{error}</p><button type="button" className={`mt-3 ${btnSecondary}`} onClick={() => setRevision((r) => r + 1)}>Try again</button></div>
          : !source ? <p role="status" className="text-gray-600">Finding this card in your notes…</p>
          : <>
            <div className="rounded-xl bg-gray-50 p-4 text-sm">
              <p className="font-semibold">{source.question}</p>
              <p className="mt-1 text-gray-700">{source.answer}</p>
            </div>
            <SourceBody source={source} markRef={mark} />
          </>}
      </div>
    </div>
  </div>;
}

function SourceBody({ source, markRef }: { source: CardSource; markRef: React.RefObject<HTMLElement | null> }) {
  if (!source.available) return <div className="mt-6 flex flex-col items-center text-center">
    <Yogo expression="thinking" size={72} />
    <p className="mt-3 font-semibold">No saved notes for this card</p>
    <p className="mt-1 max-w-sm text-sm text-gray-600">Only decks generated from uploaded notes remember where each card came from. Cards added by hand, imported, or made before this feature don’t have a source.</p>
  </div>;

  const { context } = source;
  if (context) return <>
    <p className="mt-5 text-sm text-gray-600">{source.match === "guess"
      ? "This card has no saved quote, so here’s the closest match in your notes."
      : "Highlighted below is the part of your notes this card was made from."}</p>
    <div data-notes className="relative mt-3 max-h-[62vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-5 font-serif text-[1.05rem] leading-8 whitespace-pre-wrap break-words text-gray-700">
      {context.more_before && <span className="text-gray-400">…{"\n"}</span>}
      {context.before}
      <mark ref={markRef} className="rounded bg-amber-200/80 px-0.5 text-ink [box-decoration-break:clone]">{context.match}</mark>
      {context.after}
      {context.more_after && <span className="text-gray-400">{"\n"}…</span>}
    </div>
  </>;

  return <>
    {source.excerpt && <figure className="mt-5">
      <figcaption className="text-sm text-gray-600">{source.page ? `This card was made from page ${source.page}:` : "This card was made from this part of your notes:"}</figcaption>
      <blockquote className="mt-2 rounded-r-xl border-l-4 border-amber-400 bg-amber-50 px-4 py-3 font-serif text-[1.05rem] leading-8 text-ink">{source.excerpt}</blockquote>
    </figure>}
    {source.file_url && source.kind === "pdf" && <div className="mt-5">
      <iframe title={`${source.filename || "Notes"}${source.page ? `, page ${source.page}` : ""}`} src={`${source.file_url}${source.page ? `#page=${source.page}` : ""}`} className="h-[60vh] w-full rounded-xl border border-gray-200" />
      <a href={`${source.file_url}${source.page ? `#page=${source.page}` : ""}`} target="_blank" rel="noopener" className="mt-2 inline-block text-sm font-semibold text-accent hover:underline">Open the full PDF ↗</a>
    </div>}
    {source.file_url && source.kind === "image" && /* eslint-disable-next-line @next/next/no-img-element */
      <img src={source.file_url} alt={`Your notes: ${source.filename}`} className="mt-5 w-full rounded-xl border border-gray-200" />}
    {!source.excerpt && !source.file_url && <p className="mt-5 text-sm text-gray-600">Couldn’t find this card’s passage in your notes. It may have been edited since it was generated.</p>}
  </>;
}
