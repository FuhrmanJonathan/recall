// Shared styles so every page uses the same buttons, wordmark and card.
export const btnPrimary =
  "inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-55";
export const btnSecondary =
  "inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-3 text-base font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-55";

export function Wordmark() {
  return <span className="inline-flex items-center gap-2.5 text-xl font-bold tracking-tight"><svg aria-hidden="true" width="32" height="34" viewBox="0 0 32 34" fill="none"><rect x="2" y="6" width="23" height="27" rx="5" fill="#dce5ff" stroke="#3159d6" strokeWidth="1.5" transform="rotate(-8 2 6)" /><rect x="8" y="1" width="23" height="28" rx="5" fill="#3159d6" /><path d="M14 10h11M14 15h8M14 20h5" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>Recall</span>;
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-gray-200/90 bg-white shadow-[0_2px_10px_-5px_rgba(15,23,42,0.12)] ${className}`}>
      {children}
    </div>
  );
}
