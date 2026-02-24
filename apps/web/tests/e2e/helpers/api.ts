import { expect, type APIRequestContext } from "@playwright/test";

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000";

type ApiOptions = {
  token?: string;
  json?: unknown;
  expected?: number[];
};

type ExamQuestionCreate = {
  type: "multiple_choice" | "subjective" | "coding";
  prompt_md: string;
  required: boolean;
  choices?: string[] | null;
  correct_choice_index?: number | null;
  answer_key_text?: string | null;
};

type ExamCreatePayload = {
  title: string;
  description: string;
  folder_id?: number | null;
  exam_kind: "quiz" | "assessment";
  target_track_name: string;
  status: "published" | "draft";
  duration_minutes: number | null;
  questions: ExamQuestionCreate[];
};

export type CreatedExam = {
  id: number;
  title: string;
  questions: Array<{
    id: number;
    order_index: number;
    type: string;
  }>;
};

function toErrorDetail(payload: unknown): string {
  if (payload == null) return "no-payload";
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload !== null && "detail" in payload) {
    return String((payload as { detail?: unknown }).detail);
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

export async function api(
  request: APIRequestContext,
  method: string,
  route: string,
  { token, json, expected = [200] }: ApiOptions = {},
) {
  const response = await request.fetch(`${API_BASE_URL}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    data: json !== undefined ? JSON.stringify(json) : undefined,
  });

  const contentType = response.headers()["content-type"] ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  expect(
    expected.includes(response.status()),
    `${method} ${route} expected=${expected.join(",")} actual=${response.status()} detail=${toErrorDetail(payload)}`,
  ).toBeTruthy();

  return { status: response.status(), data: payload };
}

export async function loginApi(request: APIRequestContext, username: string, password: string): Promise<string> {
  const result = await api(request, "POST", "/auth/login", {
    json: { username, password },
  });
  const token = (result.data as { access_token?: string } | null)?.access_token;
  expect(token, `missing access token for ${username}`).toBeTruthy();
  return token as string;
}

export async function registerUser(
  request: APIRequestContext,
  user: { username: string; name: string; track_name: string; password: string },
) {
  await api(request, "POST", "/auth/register", {
    json: user,
    expected: [201, 409],
  });
}

export async function createExam(
  request: APIRequestContext,
  adminToken: string,
  payload: ExamCreatePayload,
): Promise<CreatedExam> {
  const result = await api(request, "POST", "/admin/exams", {
    token: adminToken,
    json: payload,
    expected: [201],
  });
  const exam = result.data as CreatedExam;
  expect(typeof exam.id).toBe("number");
  return exam;
}

export async function deleteExam(request: APIRequestContext, adminToken: string, examId: number) {
  await api(request, "DELETE", `/admin/exams/${examId}`, {
    token: adminToken,
    expected: [204, 404],
  });
}

export async function deleteUsersByKeyword(request: APIRequestContext, adminToken: string, keyword: string) {
  const usersResult = await api(
    request,
    "GET",
    `/admin/users?keyword=${encodeURIComponent(keyword)}&limit=100`,
    {
      token: adminToken,
      expected: [200],
    },
  );
  const users = Array.isArray(usersResult.data) ? usersResult.data : [];
  for (const user of users) {
    if (!user || typeof user !== "object") continue;
    const id = (user as { id?: unknown }).id;
    if (typeof id !== "number") continue;
    await api(request, "DELETE", `/admin/users/${id}`, {
      token: adminToken,
      expected: [204],
    });
  }
}
