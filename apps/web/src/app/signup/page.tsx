"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/auth";
import AuthCard, { inputClass, submitClass } from "@/components/authcard";

export default function SignUpPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      if (res.ok) {
        await refresh();               // backend already logged them in
        router.push("/dashboard");
      } else if (res.status === 409) {
        router.push("/login?exists=1"); // already registered
      } else if (res.status === 422) {
        setError("Enter a valid email and a password of at least 5 characters.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Create your account" subtitle="Start turning your notes into flashcards.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input name="email" type="email" required autoComplete="email"
               placeholder="Email" className={inputClass} />
        <input name="password" type="password" required minLength={5}
               autoComplete="new-password"
               placeholder="Password (5+ characters)" className={inputClass} />
        <button type="submit" disabled={busy} className={submitClass}>
          {busy ? "Creating account…" : "Sign up"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
      <p className="mt-6 text-sm text-ink/70">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent underline underline-offset-2">Log in</Link>
      </p>
    </AuthCard>
  );
}
