import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

type RunPublicBody = {
  problem_id: number;
  code_text: string;
  problem_version?: number;
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as RunPublicBody | null;
  if (!body?.problem_id || !body?.code_text) {
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
  }

  const payload: { code_text: string; problem_version?: number } = { code_text: body.code_text };
  if (body.problem_version) {
    payload.problem_version = body.problem_version;
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/problems/${body.problem_id}/run-public`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const result = await response.json().catch(() => ({}));
  return NextResponse.json(result, { status: response.status });
}
