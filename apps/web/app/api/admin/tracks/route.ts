import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

function extractErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "트랙 처리에 실패했습니다.";
  }

  const data = payload as { message?: unknown; detail?: unknown };
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message;
  }
  if (typeof data.detail === "string" && data.detail.trim()) {
    return data.detail;
  }

  return "트랙 처리에 실패했습니다.";
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/admin/tracks`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => []);
  return NextResponse.json(payload, { status: response.status });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ message: "요청 본문 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/admin/tracks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json({ message: extractErrorMessage(payload), detail: payload }, { status: response.status });
  }

  return NextResponse.json(payload, { status: response.status });
}
