"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { safeDestination } from "@/components/safe-destination";
import { useAuth } from "@/components/auth";
import AuthCard, { inputClass, submitClass } from "@/components/authcard";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Only follow same-site paths like /cards.
  const next = params.get("next");
  const destination = safeDestination(next);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      if (res.ok) {
        await refresh();
        router.push(destination);
      } else {
        setError(res.status === 401 ? "Invalid email or password." : "Could not log in right now. Please try again.");
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Log in" subtitle="Welcome back. Pick up where you left off.">
      {params.get("exists") && (
        <p className="mb-4 rounded-md bg-amber-100/60 p-3 text-sm text-amber-900">
          That email already has an account. Please log in.
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="login-email" className="text-sm font-semibold">Email</label>
        <input id="login-email" disabled={busy} name="email" type="email" required autoComplete="email"
               placeholder="Email" className={inputClass} />
        <label htmlFor="login-password" className="text-sm font-semibold">Password</label>
        <input id="login-password" disabled={busy} name="password" type="password" required autoComplete="current-password"
               placeholder="Password" className={inputClass} />
        <button type="submit" disabled={busy} className={submitClass}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      </form>
      <p className="mt-6 text-sm text-ink/70">
        No account?{" "}
        <Link href={`/signup?next=${encodeURIComponent(destination)}`} className="font-medium text-accent underline underline-offset-2">Sign up</Link>
      </p>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
