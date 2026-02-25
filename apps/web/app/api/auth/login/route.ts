import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";
import { resolveSecureCookie, setAuthCookies } from "@/lib/server-auth";

export async function POST(request: Request) {
  const rawBody = await request.json().catch(() => ({}));
  const body = typeof rawBody === "object" && rawBody !== null ? rawBody : {};
  const rememberMe = (body as { remember_me?: unknown }).remember_me === true;

  const response = await fetch(`${FASTAPI_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
    return NextResponse.json(
      { message: payload?.detail ?? "로그인에 실패했습니다." },
      { status: response.status || 401 },
    );
  }

  const nextResponse = NextResponse.json({ ok: true });
  setAuthCookies(
    nextResponse,
    {
      access_token: payload.access_token,
      refresh_token: payload.refresh_token,
      token_type: payload.token_type ?? "bearer",
      remember_me: rememberMe,
    },
    resolveSecureCookie(request),
  );

  return nextResponse;
}
