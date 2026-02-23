#!/usr/bin/env node

import process from "node:process";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin1234";
const USER_PASSWORD = process.env.USER_PASSWORD ?? "userpass1234";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorDetail(payload) {
  if (payload == null) return "no-payload";
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && "detail" in payload) return String(payload.detail);
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

async function api(method, route, { token, json, body, headers, expected = [200] } = {}) {
  const requestHeaders = { ...(headers ?? {}) };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;

  let requestBody = body;
  if (json !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    requestBody = JSON.stringify(json);
  }

  const response = await fetch(`${API_BASE_URL}${route}`, {
    method,
    headers: requestHeaders,
    body: requestBody,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!expected.includes(response.status)) {
    throw new Error(
      `${method} ${route} failed: status=${response.status} expected=${expected.join(",")} detail=${toErrorDetail(payload)}`,
    );
  }
  return { status: response.status, data: payload };
}

async function login(username, password) {
  const result = await api("POST", "/auth/login", {
    json: { username, password },
    expected: [200],
  });
  if (!result.data?.access_token) {
    throw new Error(`missing access token for ${username}`);
  }
  return result.data.access_token;
}

async function main() {
  const suffix = Date.now();
  const username = `reviewcase_${suffix}`;
  const userName = `review case ${suffix}`;
  const cleanup = {
    examId: null,
    userKeyword: username,
  };

  const adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const trackCandidates = ["데이터 분석 11기", "QAQC 4기"];
  let targetTrack = trackCandidates[0];

  try {
    let registerDone = false;
    let lastRegisterError = null;
    for (const candidateTrack of trackCandidates) {
      try {
        await api("POST", "/auth/register", {
          json: {
            username,
            name: userName,
            track_name: candidateTrack,
            password: USER_PASSWORD,
          },
          expected: [201, 409],
        });
        targetTrack = candidateTrack;
        registerDone = true;
        break;
      } catch (error) {
        const message = String(error?.message ?? error);
        lastRegisterError = error;
        if (!message.includes("Track must be one of")) {
          throw error;
        }
      }
    }
    if (!registerDone) {
      throw lastRegisterError ?? new Error("failed to register test user");
    }
    const userToken = await login(username, USER_PASSWORD);

    const examCreate = await api("POST", "/admin/exams", {
      token: adminToken,
      expected: [201],
      json: {
        title: `review-flow-${suffix}`,
        description: "review pending flow check",
        exam_kind: "quiz",
        target_track_name: targetTrack,
        status: "published",
        questions: [
          {
            type: "coding",
            prompt_md: "Read csv and return first 5 rows",
            required: true,
            answer_key_text:
              "import pandas as pd\n\ndef load_head(path):\n    df = pd.read_csv(path)\n    return df.head(5)\n",
          },
        ],
      },
    });

    const examId = examCreate.data.id;
    const questionId = examCreate.data.questions[0].id;
    cleanup.examId = examId;

    const submit = await api("POST", `/exams/${examId}/submit`, {
      token: userToken,
      expected: [200],
      json: {
        answers: [
          {
            question_id: questionId,
            answer_text: "Read csv then return rows from dataframe",
          },
        ],
      },
    });
    const submissionId = submit.data.submission_id;

    await api("POST", `/admin/grading/exam-submissions/${submissionId}/enqueue`, {
      token: adminToken,
      expected: [200],
      json: { force: false },
    });

    let targetSubmission = null;
    for (let i = 0; i < 90; i += 1) {
      const rows = await api("GET", `/admin/exams/${examId}/submissions`, { token: adminToken, expected: [200] });
      const submissions = Array.isArray(rows.data) ? rows.data : [];
      targetSubmission = submissions.find((row) => row.submission_id === submissionId) ?? null;
      if (targetSubmission && !["QUEUED", "RUNNING"].includes(targetSubmission.status)) {
        break;
      }
      await sleep(1500);
    }

    if (!targetSubmission) {
      throw new Error("submission not found after grading");
    }

    const answer = (targetSubmission.answers ?? []).find((row) => row.question_id === questionId);
    const needsReview = Boolean(answer?.grading_feedback_json?.needs_review);
    if (!needsReview) {
      throw new Error(`needs_review=false feedback=${JSON.stringify(answer?.grading_feedback_json ?? null)}`);
    }

    const reviewOnlyList = await api(
      "GET",
      `/admin/grading/exam-submissions?exam_id=${examId}&coding_only=false&needs_review_only=true&limit=200`,
      {
        token: adminToken,
        expected: [200],
      },
    );
    const summaryRow = (reviewOnlyList.data ?? []).find((row) => row.submission_id === submissionId);
    if (!summaryRow || !summaryRow.has_review_pending || Number(summaryRow.review_pending_count) < 1) {
      throw new Error(`review filter mismatch row=${JSON.stringify(summaryRow ?? null)}`);
    }

    const blocked = await api("POST", "/admin/grading/exam-submissions/share", {
      token: adminToken,
      expected: [409],
      json: {
        submission_ids: [submissionId],
        published: true,
      },
    });
    const blockedDetail = toErrorDetail(blocked.data);
    if (!blockedDetail.includes("검토 필요")) {
      throw new Error(`unexpected share blocked detail: ${blockedDetail}`);
    }

    await api("POST", `/admin/grading/exam-submissions/${submissionId}/answers/${questionId}/manual-grade`, {
      token: adminToken,
      expected: [200],
      json: {
        is_correct: true,
        note: "manual confirm after review",
      },
    });

    await api("POST", "/admin/grading/exam-submissions/share", {
      token: adminToken,
      expected: [200],
      json: {
        submission_ids: [submissionId],
        published: true,
      },
    });

    console.log(
      JSON.stringify(
        {
          result: "PASS",
          examId,
          submissionId,
          needsReview,
          reviewPendingCount: summaryRow.review_pending_count,
        },
        null,
        2,
      ),
    );
  } finally {
    if (cleanup.examId != null) {
      await api("DELETE", `/admin/exams/${cleanup.examId}`, {
        token: adminToken,
        expected: [204, 404],
      });
    }
    const users = await api("GET", `/admin/users?keyword=${encodeURIComponent(cleanup.userKeyword)}&limit=100`, {
      token: adminToken,
      expected: [200],
    });
    const list = Array.isArray(users.data) ? users.data : [];
    for (const user of list) {
      await api("DELETE", `/admin/users/${user.id}`, {
        token: adminToken,
        expected: [204],
      });
    }
  }
}

main().catch((error) => {
  console.error("[review-pending-flow-check] FAIL");
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
