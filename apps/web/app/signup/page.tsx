"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const TRACK_OPTIONS = ["데이터 분석 11기", "QAQC 4기"] as const;
type FieldKey = "username" | "name" | "trackName" | "password" | "confirm";

function FieldStatus({ state }: { state: "idle" | "valid" | "invalid" }) {
  if (state === "idle") return null;
  if (state === "valid") {
    return (
      <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-sm font-bold text-emerald-600">
        ✓
      </span>
    );
  }
  return (
    <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center text-sm font-bold text-rose-600">
      ✕
    </span>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [trackName, setTrackName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>({
    username: false,
    name: false,
    trackName: false,
    password: false,
    confirm: false,
  });

  const validations = useMemo(
    () => ({
      username: username.trim().length > 0,
      name: name.trim().length > 0,
      trackName: trackName.trim().length > 0,
      password: password.length >= 8,
      confirm: confirm.length > 0 && confirm === password,
    }),
    [confirm, name, password, trackName, username]
  );

  const statusFor = (field: FieldKey): "idle" | "valid" | "invalid" => {
    const show = submitAttempted || touched[field];
    if (!show) return "idle";
    return validations[field] ? "valid" : "invalid";
  };

  const touchField = (field: FieldKey) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const toErrorMessage = (payload: unknown): string => {
    if (!payload || typeof payload !== "object") return "회원가입에 실패했습니다.";
    const data = payload as { detail?: unknown; message?: unknown };

    if (typeof data.message === "string" && data.message.trim()) return data.message;
    if (typeof data.detail === "string" && data.detail.trim()) return data.detail;

    if (Array.isArray(data.detail)) {
      const first = data.detail[0] as { msg?: unknown } | undefined;
      if (first && typeof first.msg === "string" && first.msg.trim()) return first.msg;
      return "입력값을 다시 확인해 주세요.";
    }

    return "회원가입에 실패했습니다.";
  };

  const buildValidationError = (): string | null => {
    const issues: string[] = [];
    if (!validations.username) issues.push("아이디를 입력해 주세요");
    if (!validations.name) issues.push("이름을 입력해 주세요");
    if (!validations.trackName) issues.push("트랙을 선택해 주세요");
    if (!password) {
      issues.push("비밀번호를 입력해 주세요");
    } else if (password.length < 8) {
      issues.push("비밀번호는 8자 이상이어야 합니다");
    }
    if (!confirm) {
      issues.push("비밀번호 확인을 입력해 주세요");
    } else if (password !== confirm) {
      issues.push("비밀번호 확인이 일치하지 않습니다");
    }
    if (issues.length === 0) return null;
    return `다음 항목을 확인해 주세요: ${issues.join(", ")}`;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSubmitAttempted(true);

    const validationError = buildValidationError();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const normalizedUsername = username.trim().toLowerCase();
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: normalizedUsername, name: name.trim(), track_name: trackName, password }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(toErrorMessage(payload));
      setLoading(false);
      return;
    }

    await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: normalizedUsername, password }),
    });

    router.push("/");
    router.refresh();
  };

  return (
    <div className="min-h-screen">
      <main className="qa-shell flex min-h-screen items-center justify-center py-12">
        <section className="qa-card w-full max-w-md">
          <BackButton />
          <p className="qa-kicker mt-4">새 계정 만들기</p>
          <h1 className="mb-6 mt-2 text-3xl font-bold">회원가입</h1>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="relative">
              <Input
                className="pr-9"
                placeholder="아이디"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onBlur={() => touchField("username")}
                required
              />
              <FieldStatus state={statusFor("username")} />
            </div>

            <div className="space-y-1">
              <div className="relative">
                <Input
                  className="pr-9"
                  placeholder="이름"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => touchField("name")}
                  required
                />
                <FieldStatus state={statusFor("name")} />
              </div>
              <p className="text-xs font-semibold text-destructive">반드시 본인 실명을 정확히 입력해 주세요</p>
            </div>

            <div className="relative">
              <select
                className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 pr-9 text-sm"
                value={trackName}
                onChange={(e) => setTrackName(e.target.value)}
                onBlur={() => touchField("trackName")}
                required
              >
                <option value="">본인 트랙 선택</option>
                {TRACK_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <FieldStatus state={statusFor("trackName")} />
            </div>

            <div className="relative">
              <Input
                className="pr-9"
                type="password"
                placeholder="비밀번호 (8자 이상)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => touchField("password")}
                required
              />
              <FieldStatus state={statusFor("password")} />
            </div>

            <div className="relative">
              <Input
                className="pr-9"
                type="password"
                placeholder="비밀번호 확인"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onBlur={() => touchField("confirm")}
                required
              />
              <FieldStatus state={statusFor("confirm")} />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="w-full" disabled={loading}>
              {loading ? "가입 중..." : "회원가입"}
            </Button>
            <p className="text-xs text-muted-foreground">
              이미 계정이 있나요?{" "}
              <Link href="/login" className="underline">
                로그인
              </Link>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
