"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ForgotResponse = {
  message?: string;
  reset_token?: string | null;
};

export default function ForgotPasswordPage() {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setToken("");

    const response = await fetch("/api/auth/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const payload = (await response.json().catch(() => ({}))) as ForgotResponse;

    setMessage(payload.message ?? (response.ok ? "Request accepted." : "Request failed."));
    if (payload.reset_token) {
      setToken(payload.reset_token);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen">
      <main className="qa-shell flex min-h-screen items-center justify-center py-12">
        <section className="qa-card w-full max-w-md space-y-4">
          <BackButton />
          <p className="qa-kicker">Password Recovery</p>
          <h1 className="text-3xl font-bold">Reset Password</h1>
          <form onSubmit={onSubmit} className="space-y-3">
            <Input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Button className="w-full" disabled={loading}>
              {loading ? "Requesting..." : "Request reset token"}
            </Button>
          </form>
          {message ? <p className="text-sm">{message}</p> : null}
          {token ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs">
              <p className="font-semibold">Development reset token</p>
              <p className="mt-1 break-all">{token}</p>
              <Link href={`/reset-password?token=${token}`} className="mt-2 inline-block underline">
                Use this token to reset password
              </Link>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Back to login{" "}
            <Link href="/login" className="underline">
              /login
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
