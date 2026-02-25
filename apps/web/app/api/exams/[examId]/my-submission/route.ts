import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";
import { clearAuthCookies, fetchFastApiWithAuthRetry, resolveSecureCookie, setAuthCookies } from "@/lib/server-auth";

type Params = {
  params: { examId: string } | Promise<{ examId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { examId } = await Promise.resolve(params);

  const { upstream, refreshedTokens } = await fetchFastApiWithAuthRetry(
    `${FASTAPI_BASE_URL}/exams/${examId}/my-submission`,
    {},
    { unauthenticatedMessage: "인증이 필요합니다." },
  );

  const payload = await upstream.json().catch(() => ({}));
  const response = NextResponse.json(payload, { status: upstream.status });

  if (refreshedTokens) {
    setAuthCookies(response, refreshedTokens, resolveSecureCookie(request));
  } else if (upstream.status === 401) {
    clearAuthCookies(response);
  }

  return response;
}
