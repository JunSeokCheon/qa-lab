import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const response = await fetch(`${FASTAPI_BASE_URL}/admin/grading/exam-submissions/share`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
