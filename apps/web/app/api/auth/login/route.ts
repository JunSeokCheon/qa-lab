import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json();

  const response = await fetch(`${FASTAPI_BASE_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    return NextResponse.json(
      { message: payload?.detail ?? "Login failed" },
      { status: response.status || 401 },
    );
  }

  const nextResponse = NextResponse.json({ ok: true });
  nextResponse.cookies.set("access_token", payload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60,
  });

  return nextResponse;
}
