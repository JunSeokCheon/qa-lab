import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

type Params = {
  params:
    | { submissionId: string; questionId: string }
    | Promise<{ submissionId: string; questionId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { submissionId, questionId } = await Promise.resolve(params);
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const response = await fetch(
    `${FASTAPI_BASE_URL}/admin/grading/exam-submissions/${submissionId}/answers/${questionId}/manual-grade`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
