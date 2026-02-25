import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FASTAPI_BASE_URL } from "@/lib/auth";

type Params = {
  params: { examId: string } | Promise<{ examId: string }>;
};

export async function GET(_: Request, { params }: Params) {
  const { examId } = await Promise.resolve(params);
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const response = await fetch(`${FASTAPI_BASE_URL}/admin/exams/${examId}/resources`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}

export async function POST(request: Request, { params }: Params) {
  const { examId } = await Promise.resolve(params);
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) {
    return NextResponse.json({ message: "인증이 필요합니다." }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ message: "멀티파트 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string" || typeof (file as Blob).arrayBuffer !== "function") {
    return NextResponse.json({ message: "파일이 필요합니다." }, { status: 400 });
  }

  const forwardForm = new FormData();
  const upload = file as Blob & { name?: string };
  forwardForm.append("file", upload, upload.name ?? "resource.bin");

  const response = await fetch(`${FASTAPI_BASE_URL}/admin/exams/${examId}/resources`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: forwardForm,
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, { status: response.status });
}

