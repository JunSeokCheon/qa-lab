"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResetPasswordClient() {
  const params = useSearchParams();
  const initialToken = params.get("token") ?? "";
  const [token, setToken] = useState(initialToken);
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setError("");
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    const response = await fetch("/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_password: newPassword }),
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string; detail?: string };

    if (!response.ok) {
      setError(payload.detail ?? payload.message ?? "Failed to reset password.");
      setLoading(false);
      return;
    }
    setMessage(payload.message ?? "Password has been reset.");
    setLoading(false);
  };

  return (
    <div className="min-h-screen">
      <main className="qa-shell flex min-h-screen items-center justify-center py-12">
        <section className="qa-card w-full max-w-md space-y-4">
          <BackButton />
          <p className="qa-kicker">Set New Password</p>
          <h1 className="text-3xl font-bold">Reset Password</h1>
          <form onSubmit={onSubmit} className="space-y-3">
            <Input placeholder="reset token" value={token} onChange={(e) => setToken(e.target.value)} />
            <Input
              type="password"
              placeholder="new password (8+)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
            <Button className="w-full" disabled={loading}>
              {loading ? "Resetting..." : "Reset Password"}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Go to login:{" "}
            <Link href="/login" className="underline">
              /login
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
