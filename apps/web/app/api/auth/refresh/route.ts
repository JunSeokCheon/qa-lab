import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  clearAuthCookies,
  requestRefreshTokens,
  resolveSecureCookie,
  setAuthCookies,
} from "@/lib/server-auth";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refresh_token")?.value;

  if (!refreshToken) {
    return NextResponse.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const refreshed = await requestRefreshTokens(refreshToken);
  if (!refreshed) {
    const response = NextResponse.json({ message: "인증이 유효하지 않습니다." }, { status: 401 });
    clearAuthCookies(response);
    return response;
  }

  const response = NextResponse.json({ ok: true });
  setAuthCookies(response, refreshed, resolveSecureCookie(request));
  return response;
}

