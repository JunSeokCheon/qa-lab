import { NextResponse, type NextRequest } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

type Params = {
  params: { submissionId: string } | Promise<{ submissionId: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { submissionId } = await Promise.resolve(params);
  const token = request.cookies.get("access_token")?.value;

  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/admin/submissions/${submissionId}/regrade`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
