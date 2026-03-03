import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

export async function DELETE(_: Request, context: { params: Promise<{ trackName: string }> }) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const { trackName } = await context.params;
  const response = await fetch(`${FASTAPI_BASE_URL}/admin/tracks/${encodeURIComponent(trackName)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (response.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
