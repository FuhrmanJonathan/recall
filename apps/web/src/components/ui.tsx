import Yogo from "@/components/yogo";

// Shared styles so every page uses the same buttons, wordmark and card.
export const btnPrimary =
  "inline-flex items-center justify-center rounded-xl bg-accent px-5 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-55";
export const btnSecondary =
  "inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-3 text-base font-medium transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-55";

export function Wordmark() {
  return <span className="inline-flex items-center gap-2.5 text-xl font-bold tracking-tight"><Yogo size={36} className="shrink-0" />Recall</span>;
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
