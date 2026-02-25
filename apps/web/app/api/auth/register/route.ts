import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "회원가입에 실패했습니다.";
  }

  const data = payload as { message?: unknown; detail?: unknown };
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message;
  }
  if (typeof data.detail === "string" && data.detail.trim()) {
    return data.detail;
  }
  if (Array.isArray(data.detail)) {
    const first = data.detail[0] as { msg?: unknown } | undefined;
    if (first && typeof first.msg === "string" && first.msg.trim()) {
      return first.msg;
    }
  }

  return "회원가입에 실패했습니다.";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ message: "요청 본문 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ message: extractErrorMessage(payload), detail: payload }, { status: response.status });
  }

  return NextResponse.json(payload, { status: response.status });
}

