"use client";
import { useState } from "react";
import {useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function SignUpPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");

  async function onSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });

    if (res.ok) {
      router.push("/dashboard");   // backend already logged them in
      router.refresh();
    } else if (res.status === 409) {
      router.push("/login?exists=1");   // already registered
    } else if (res.status === 422) {
      setError("Enter a valid email and a password of at least 5 characters.");
    } else {
      setError("Something went wrong. Please try again.");
    }
  }

  return (
    <main className="mx-auto max-w-sm p-6">
      <h2 className="mb-4 text-2xl font-semibold">Sign up</h2>
      {params.get("exists") && (
        <p className="mb-3 rounded bg-yellow-100 p-2 text-black">
          That email already has an account. Please log in.
        </p>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input name="email" type="email" required autoComplete="email"
               placeholder="Email" className="rounded border p-2" />
        <input name="password" type="password" required minLength={5}
               autoComplete="new-password"
               placeholder="Password (5+ characters)" className="rounded border p-2" />
        <button type="submit" className="rounded bg-blue-600 p-2 text-white">
          Sign up
        </button>
        {error && <p className="text-red-600">{error}</p>}
      </form>

      <p className="mt-4 text-sm">
        Already have an account?{" "}
        <Link href="/login" className="underline">Log in</Link>
      </p>
    </main>
  );
}