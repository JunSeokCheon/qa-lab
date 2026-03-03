import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

export async function GET() {
  const response = await fetch(`${FASTAPI_BASE_URL}/tracks`, {
    cache: "no-store",
  });
  const payload = await response.json().catch(() => []);
  return NextResponse.json(payload, { status: response.status });
}
