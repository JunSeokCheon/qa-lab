import { NextResponse, type NextRequest } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

type Params = {
  params: { problemId: string } | Promise<{ problemId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const token = request.cookies.get("access_token")?.value;
  const { problemId } = await Promise.resolve(params);

  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ message: "Invalid request body" }, { status: 400 });
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/problems/${problemId}/run-public`, {
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
