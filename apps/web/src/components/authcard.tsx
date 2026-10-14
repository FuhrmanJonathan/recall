// Shared look for the login and signup forms.
export const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15";
export const submitClass =
  "w-full rounded-md bg-accent px-3 py-2 font-medium text-white transition hover:bg-accent-dark disabled:opacity-60";

export default function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto mt-6 max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mb-6 mt-1 text-sm text-ink/60">{subtitle}</p>
      {children}
    </div>
  );
}
