// Shared styles so every page uses the same buttons, wordmark and card.
export const btnPrimary =
  "inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-dark";
export const btnSecondary =
  "inline-block rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium transition hover:bg-gray-50";

export function Wordmark() {
  return <span className="text-lg font-semibold tracking-tight">Recall</span>;
}

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}
