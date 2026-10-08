"use client";
import { Suspense, useState } from "react";
import { useRouter} from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function onSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const form = new FormData(e.currentTarget);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });

    if (res.ok) {
      router.push("/dashboard");
      router.refresh();
    } else {
      setError("Invalid email or password");
    }
  }
  return (
    <main className="mx-auto max-w-sm p-6">
      <h2 className="mb-4 text-2xl font-semibold">Log in</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input name="email" type="email" required autoComplete="email"
               placeholder="Email" className="rounded border p-2" />
        <input name="password" type="password" required autoComplete="current-password"
               placeholder="Password" className="rounded border p-2" />
        <button type="submit" className="rounded bg-blue-600 p-2 text-white">
          Log in
        </button>
        {error && <p className="text-red-600">{error}</p>}
      </form>
      {/* signup button */}
      <p className="mt-4 text-sm">
        No account?{" "}
        <Link href="/signup" className="underline">Sign up</Link>
      </p>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}