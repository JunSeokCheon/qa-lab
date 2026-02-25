import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";
import { clearAuthCookies, fetchFastApiWithAuthRetry, resolveSecureCookie, setAuthCookies } from "@/lib/server-auth";

export async function GET(request: Request) {
  const { upstream, refreshedTokens } = await fetchFastApiWithAuthRetry(
    `${FASTAPI_BASE_URL}/me`,
    {},
    { unauthenticatedMessage: "인증이 필요합니다." },
  );

  if (!upstream.ok) {
    const response = NextResponse.json({ message: "인증이 유효하지 않습니다." }, { status: upstream.status });
    if (upstream.status === 401) {
      clearAuthCookies(response);
    }
    return response;
  }

  const payload = await upstream.json().catch(() => ({}));
  const response = NextResponse.json(payload);
  if (refreshedTokens) {
    setAuthCookies(response, refreshedTokens, resolveSecureCookie(request));
  }
  return response;
}

