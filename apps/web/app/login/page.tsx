"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TEXT = {
  loginTitle: "\uB85C\uADF8\uC778",
  username: "\uC544\uC774\uB514",
  password: "\uBE44\uBC00\uBC88\uD638",
  rememberMe: "\uC790\uB3D9 \uB85C\uADF8\uC778",
  loginFailed: "\uB85C\uADF8\uC778\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4.",
  failedCountPrefix: "\uB85C\uADF8\uC778 \uC2E4\uD328 \uD69F\uC218",
  loggingIn: "\uB85C\uADF8\uC778 \uC911...",
  signup: "\uD68C\uC6D0\uAC00\uC785",
  resetPassword: "\uBE44\uBC00\uBC88\uD638 \uC7AC\uC124\uC815",
} as const;

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [failedCount, setFailedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
          remember_me: rememberMe,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        setError(payload.message ?? TEXT.loginFailed);
        setFailedCount((prev) => prev + 1);
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <main className="qa-shell flex min-h-screen items-center justify-center py-12">
        <section className="qa-card w-full max-w-md">
          <BackButton />
          <h1 className="mb-6 mt-2 text-3xl font-bold">{TEXT.loginTitle}</h1>
          <form onSubmit={onSubmit} className="space-y-4">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={TEXT.username} />
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={TEXT.password}
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              {TEXT.rememberMe}
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {failedCount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {TEXT.failedCountPrefix}: {failedCount}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? TEXT.loggingIn : TEXT.loginTitle}
            </Button>
            <Link href="/signup" className="block">
              <Button type="button" variant="outline" className="w-full">
                {TEXT.signup}
              </Button>
            </Link>
            <div className="flex items-center justify-end text-xs">
              <Link className="underline" href="/forgot-password">
                {TEXT.resetPassword}
              </Link>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
