"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth";
import { inputClass, submitClass } from "@/components/authcard";

type Challenge = { client_id: string | null; nonce: string | null };
type Credential = { credential: string };
type GoogleAPI = {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        nonce: string;
        callback: (response: Credential) => void;
        auto_select: boolean;
        ux_mode: "popup";
      }) => void;
      renderButton: (element: HTMLElement, options: {
        theme: "outline"; size: "large"; text: "continue_with";
      }) => void;
    };
  };
};

// Share in-flight requests so React's development remount does not race two
// different nonce cookies. The server reuses an unexpired challenge on navigation.
let pendingChallenge: Promise<Challenge> | null = null;
function getChallenge() {
  if (!pendingChallenge) {
    pendingChallenge = fetch("/api/auth/google/challenge", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load Google sign-in. Please try again.");
        return await response.json() as Challenge;
      })
      .finally(() => { pendingChallenge = null; });
  }
  return pendingChallenge;
}

export default function GoogleSignIn({ destination, busy, onBusyChange }: {
  destination: string;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const router = useRouter();
  const { refresh } = useAuth();
  const button = useRef<HTMLDivElement>(null);
  const working = useRef(false);
  const mounted = useRef(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [ready, setReady] = useState(false);
  const [scriptFailed, setScriptFailed] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState<{ credential: string; email: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    getChallenge().then(
      (value) => { if (active) setChallenge(value); },
      () => { if (active) setError("Could not load Google sign-in. Please try again."); },
    );
    return () => { active = false; mounted.current = false; };
  }, []);

  const signIn = useCallback(async (credential: string, password?: string) => {
    if (working.current) return;
    working.current = true;
    onBusyChange(true);
    setError("");
    try {
      const response = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential, password }),
      });
      const body = await response.json();
      if (!mounted.current) return;
      if (response.ok) {
        setLink(null);
        await refresh();
        if (mounted.current) router.push(destination);
      } else if (response.status === 409 && body.detail?.code === "link_required") {
        setLink({ credential, email: body.detail.email });
      } else {
        setError(typeof body.detail === "string" ? body.detail : "Could not sign in with Google. Please try again.");
      }
    } catch {
      if (mounted.current) setError("Couldn't reach the server. Please try again.");
    } finally {
      working.current = false;
      if (mounted.current) onBusyChange(false);
    }
  }, [destination, onBusyChange, refresh, router]);

  useEffect(() => {
    const google = (window as Window & { google?: GoogleAPI }).google;
    if (!ready || !challenge?.client_id || !challenge.nonce || !google || !button.current) return;
    let active = true;
    google.accounts.id.initialize({
      client_id: challenge.client_id,
      nonce: challenge.nonce,
      auto_select: false,
      ux_mode: "popup",
      callback: ({ credential }) => { if (active) void signIn(credential); },
    });
    const element = button.current;
    element.replaceChildren();
    google.accounts.id.renderButton(element, { theme: "outline", size: "large", text: "continue_with" });
    return () => { active = false; element.replaceChildren(); };
  }, [challenge, ready, signIn]);

  async function retry() {
    setLink(null);
    setError("");
    try {
      const value = await getChallenge();
      if (mounted.current) setChallenge(value);
    } catch {
      if (mounted.current) setError("Could not load Google sign-in. Please try again.");
    }
  }

  if (!challenge?.client_id && !error) return null;

  return (
    <div className="mb-5">
      {challenge?.client_id && (
        <Script
          src="https://accounts.google.com/gsi/client"
          onReady={() => setReady(true)}
          onError={() => {
            setScriptFailed(true);
            setError("Google could not load. Reload this page or use email and password.");
          }}
        />
      )}
      <div inert={busy || !!link} className={busy || link ? "opacity-50" : ""}>
        <div ref={button} className="flex justify-center" />
      </div>
      {link && (
        <form className="mt-4 flex flex-col gap-3" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void signIn(link.credential, String(form.get("password") ?? ""));
        }}>
          <p className="text-sm text-ink/70">
            {link.email} already has a Recall account. Enter its password to connect Google and keep your decks.
          </p>
          <input type="hidden" name="username" value={link.email} autoComplete="username" />
          <label htmlFor="google-link-password" className="text-sm font-semibold">Recall password</label>
          <input id="google-link-password" name="password" type="password" autoComplete="current-password"
                 required disabled={busy} className={inputClass} />
          <button type="submit" disabled={busy} className={submitClass}>
            {busy ? "Connecting…" : "Connect Google and sign in"}
          </button>
          <Link href="/reset-password" className="text-sm text-accent underline">Forgot password?</Link>
          <button type="button" disabled={busy} onClick={retry} className="text-sm text-ink/60 underline">Cancel</button>
        </form>
      )}
      {error && (
        <div className="mt-3 text-sm">
          <p role="alert" className="text-red-800">{error}</p>
          <button type="button" disabled={busy} onClick={scriptFailed ? () => window.location.reload() : retry}
                  className="mt-1 text-accent underline">
            {scriptFailed ? "Reload page" : "Try Google again"}
          </button>
        </div>
      )}
      <p className="mt-5 text-center text-xs text-ink/40">or use email and password</p>
    </div>
  );
}
