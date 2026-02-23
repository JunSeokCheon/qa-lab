"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [failedCount, setFailedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const submitLogin = async (nextUsername: string, nextPassword: string) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username: nextUsername, password: nextPassword }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        setError(payload.message ?? "로그인에 실패했습니다.");
        setFailedCount((prev) => prev + 1);
        return;
      }

      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitLogin(username, password);
  };

  const onAutoLogin = async (account: "admin" | "user") => {
    const nextUsername = account;
    const nextPassword = account === "admin" ? "admin1234" : "user1234";
    setUsername(nextUsername);
    setPassword(nextPassword);
    await submitLogin(nextUsername, nextPassword);
  };

  return (
    <div className="min-h-screen">
      <main className="qa-shell flex min-h-screen items-center justify-center py-12">
        <section className="qa-card w-full max-w-md">
          <BackButton />
          <h1 className="mb-6 mt-2 text-3xl font-bold">로그인</h1>
          <form onSubmit={onSubmit} className="space-y-4">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="아이디" />
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="비밀번호"
            />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {failedCount > 0 ? <p className="text-xs text-muted-foreground">로그인 실패 횟수: {failedCount}</p> : null}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "로그인 중..." : "로그인"}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" disabled={loading} onClick={() => void onAutoLogin("admin")}>
                관리자 자동 로그인
              </Button>
              <Button type="button" variant="outline" disabled={loading} onClick={() => void onAutoLogin("user")}>
                수강생 자동 로그인
              </Button>
            </div>
            <Link href="/signup" className="block">
              <Button type="button" variant="outline" className="w-full">
                회원가입
              </Button>
            </Link>
            <div className="flex items-center justify-end text-xs">
              <Link className="underline" href="/forgot-password">
                비밀번호 재설정
              </Link>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
