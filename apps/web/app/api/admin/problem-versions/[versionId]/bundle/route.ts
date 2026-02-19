import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

type Params = {
  params: { versionId: string } | Promise<{ versionId: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const { versionId } = await Promise.resolve(params);
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const incoming = await request.formData();
  const file = incoming.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "File is required" }, { status: 400 });
  }

  const form = new FormData();
  form.append("file", file, file.name);

  const response = await fetch(`${FASTAPI_BASE_URL}/admin/problem-versions/${versionId}/bundle`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}
