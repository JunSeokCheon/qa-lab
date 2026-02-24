import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

type Params = {
  params:
    | { examId: string; resourceId: string }
    | Promise<{ examId: string; resourceId: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { examId, resourceId } = await Promise.resolve(params);
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "Authentication is required" }, { status: 401 });
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/exams/${examId}/resources/${resourceId}/download`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, { status: response.status });
  }

  const headers = new Headers();
  const contentType = response.headers.get("content-type");
  const contentDisposition = response.headers.get("content-disposition");
  const contentLength = response.headers.get("content-length");

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

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
