import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

const ACCESS_TOKEN_COOKIE_MAX_AGE_REMEMBER_SECONDS = 60 * 60 * 24 * 30;
const REFRESH_TOKEN_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const REFRESH_TOKEN_COOKIE_MAX_AGE_REMEMBER_SECONDS = 60 * 60 * 24 * 30;

export type AuthTokenPayload = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  remember_me?: boolean;
};

type AuthFetchOptions = {
  unauthenticatedMessage?: string;
};

export function resolveSecureCookie(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  return (
    process.env.AUTH_COOKIE_SECURE === "1" ||
    forwardedProto === "https" ||
    requestUrl.protocol === "https:"
  );
}

export function clearAuthCookies(response: NextResponse): void {
  response.cookies.delete("access_token");
  response.cookies.delete("refresh_token");
}

export function setAuthCookies(response: NextResponse, payload: AuthTokenPayload, secureCookie: boolean): void {
  const rememberMe = payload.remember_me === true;

  response.cookies.set("access_token", payload.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    ...(rememberMe ? { maxAge: ACCESS_TOKEN_COOKIE_MAX_AGE_REMEMBER_SECONDS } : {}),
  });

  response.cookies.set("refresh_token", payload.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    maxAge: rememberMe ? REFRESH_TOKEN_COOKIE_MAX_AGE_REMEMBER_SECONDS : REFRESH_TOKEN_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function requestRefreshTokens(refreshToken: string): Promise<AuthTokenPayload | null> {
  const response = await fetch(`${FASTAPI_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    cache: "no-store",
  });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as AuthTokenPayload | null;
  if (!payload?.access_token || !payload?.refresh_token) {
    return null;
  }
  return payload;
}

function unauthorizedResponse(message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function fetchFastApiWithAuthRetry(
  url: string,
  init: RequestInit = {},
  options: AuthFetchOptions = {},
): Promise<{ upstream: Response; refreshedTokens: AuthTokenPayload | null }> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value ?? null;
  const refreshToken = cookieStore.get("refresh_token")?.value ?? null;
  const unauthenticatedMessage = options.unauthenticatedMessage ?? "인증이 필요합니다.";

  const requestWithToken = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(url, {
      ...init,
      headers,
      cache: init.cache ?? "no-store",
    });
  };

  if (accessToken) {
    const firstAttempt = await requestWithToken(accessToken);
    if (firstAttempt.status !== 401) {
      return { upstream: firstAttempt, refreshedTokens: null };
    }

    if (!refreshToken) {
      return { upstream: firstAttempt, refreshedTokens: null };
    }

    const refreshedTokens = await requestRefreshTokens(refreshToken);
    if (!refreshedTokens) {
      return { upstream: firstAttempt, refreshedTokens: null };
    }

    const secondAttempt = await requestWithToken(refreshedTokens.access_token);
    return { upstream: secondAttempt, refreshedTokens };
  }

  if (!refreshToken) {
    return { upstream: unauthorizedResponse(unauthenticatedMessage), refreshedTokens: null };
  }

  const refreshedTokens = await requestRefreshTokens(refreshToken);
  if (!refreshedTokens) {
    return { upstream: unauthorizedResponse(unauthenticatedMessage), refreshedTokens: null };
  }

  const upstream = await requestWithToken(refreshedTokens.access_token);
  return { upstream, refreshedTokens };
}

