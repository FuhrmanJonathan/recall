"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthCard, { inputClass, submitClass } from "@/components/authcard";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const endpoint = token ? "/api/auth/password/reset" : "/api/auth/password/forgot";
    const body = token
      ? { token, password: form.get("password") }
      : { email: form.get("email") };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(token
          ? "This reset link is invalid or expired. Request a new one."
          : "Could not request a reset right now. Please try again.");
      } else {
        setMessage(token
          ? "Your password was reset. You can now log in."
          : "If that email has an account, a reset link has been sent.");
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={token ? "Choose a new password" : "Reset your password"}
      subtitle={token
        ? "Enter a new password for your account."
        : "We'll email you a link to reset your password."}
    >
      {message ? (
        <p role="status" className="text-sm text-ink/70">{message}</p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {!token ? (
            <>
              <label htmlFor="reset-email" className="text-sm font-semibold">Email</label>
              <input id="reset-email" name="email" type="email" required autoComplete="email"
                     placeholder="Email" className={inputClass} />
            </>
          ) : (
            <>
              <label htmlFor="reset-password" className="text-sm font-semibold">
                New password (at least 5 characters)
              </label>
              <input id="reset-password" name="password" type="password" required minLength={5}
                     autoComplete="new-password" placeholder="New password" className={inputClass} />
            </>
          )}
          <button type="submit" disabled={busy} className={submitClass}>
            {busy ? "Please wait…" : token ? "Reset password" : "Email reset link"}
          </button>
          {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        </form>
      )}
      <p className="mt-6 text-sm text-ink/70">
        <Link href="/login" className="font-medium text-accent underline underline-offset-2">
          Back to log in
        </Link>
      </p>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetPasswordForm /></Suspense>;
}
