import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";
import { clearAuthCookies, fetchFastApiWithAuthRetry, resolveSecureCookie, setAuthCookies } from "@/lib/server-auth";

type Params = {
  params:
    | { examId: string; resourceId: string }
    | Promise<{ examId: string; resourceId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { examId, resourceId } = await Promise.resolve(params);
  const inline = new URL(request.url).searchParams.get("inline") === "1";

  const { upstream, refreshedTokens } = await fetchFastApiWithAuthRetry(
    `${FASTAPI_BASE_URL}/exams/${examId}/resources/${resourceId}/download`,
    {},
    { unauthenticatedMessage: "인증이 필요합니다." },
  );

  if (!upstream.ok) {
    const payload = await upstream.json().catch(() => ({}));
    const response = NextResponse.json(payload, { status: upstream.status });
    if (refreshedTokens) {
      setAuthCookies(response, refreshedTokens, resolveSecureCookie(request));
    } else if (upstream.status === 401) {
      clearAuthCookies(response);
    }
    return response;
  }

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  const contentDisposition = upstream.headers.get("content-disposition");
  const contentLength = upstream.headers.get("content-length");

  if (contentType) headers.set("content-type", contentType);
  if (contentLength) headers.set("content-length", contentLength);
  if (inline) {
    if (contentDisposition) {
      headers.set("content-disposition", contentDisposition.replace(/^attachment/i, "inline"));
    } else {
      headers.set("content-disposition", "inline");
    }
  } else if (contentDisposition) {
    headers.set("content-disposition", contentDisposition);
  }

  const response = new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });

  if (refreshedTokens) {
    setAuthCookies(response, refreshedTokens, resolveSecureCookie(request));
  }

  return response;
}

