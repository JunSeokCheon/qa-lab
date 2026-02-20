#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
const QA_TRACK = "QAQC 4기";
const OTHER_TRACK = "데이터 분석 11기";
const USERS = Number.parseInt(process.env.VIRTUAL_USERS ?? "12", 10);
const MAIN_ZIP_PATH = process.env.MAIN_ZIP_PATH;
const FALLBACK_ZIP_PATH = process.env.FALLBACK_ZIP_PATH;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function runCommand(command, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit=${code}: ${stderr || stdout}`));
    });
  });
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
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!expected.includes(response.status)) {
    throw new Error(
      `${method} ${route} failed: status=${response.status} expected=${expected.join(",")} detail=${toErrorDetail(data)}`,
    );
  }

  return { status: response.status, data };
}

function ensure(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

async function login(username, password) {
  const result = await api("POST", "/auth/login", {
    json: { username, password },
  });
  ensure(result.data?.access_token, `missing access token for user=${username}`);
  return result.data.access_token;
}

async function registerUser({ username, name, track_name, password }) {
  const result = await api("POST", "/auth/register", {
    json: { username, name, track_name, password },
    expected: [201, 409],
  });
  return result.status;
}

async function uploadExamZip(examId, token, zipPath) {
  const absolute = path.resolve(zipPath);
  const bytes = await fs.readFile(absolute);
  const form = new FormData();
  form.append("file", new Blob([bytes]), path.basename(absolute));

  const upload = await api("POST", `/admin/exams/${examId}/resources`, {
    token,
    body: form,
    expected: [201],
  });

  return upload.data;
}

async function waitForAdminSubmissions(examId, token, expectedCount, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await api("GET", `/admin/exams/${examId}/submissions`, { token });
    const submissions = Array.isArray(result.data) ? result.data : [];
    const inFlight = submissions.filter((item) => ["QUEUED", "RUNNING"].includes(item.status)).length;
    if (submissions.length >= expectedCount && inFlight === 0) {
      return submissions;
    }
    await sleep(2_000);
  }

  throw new Error(`timeout waiting submissions exam_id=${examId} expected=${expectedCount}`);
}

async function createFixtureArchives(baseDir) {
  const mainRoot = path.join(baseDir, "resource-main");
  const fallbackRoot = path.join(baseDir, "resource-fallback");
  const mainTestsDir = path.join(mainRoot, "tests", "question_3");
  const fallbackTestsDir = path.join(fallbackRoot, "tests");

  await fs.mkdir(mainTestsDir, { recursive: true });
  await fs.mkdir(fallbackTestsDir, { recursive: true });

  await fs.writeFile(
    path.join(mainTestsDir, "test_solution.py"),
    [
      "from solution import solve",
      "",
      "",
      "def test_add_positive() -> None:",
      "    assert solve(2, 3) == 5",
      "",
      "",
      "def test_add_negative() -> None:",
      "    assert solve(-1, 1) == 0",
      "",
    ].join("\n"),
    "utf-8",
  );

  await fs.writeFile(
    path.join(fallbackTestsDir, "test_solution.py"),
    [
      "from solution import solve",
      "",
      "",
      "def test_add_default_path() -> None:",
      "    assert solve(10, 5) == 15",
      "",
    ].join("\n"),
    "utf-8",
  );

  const mainZipPath = path.join(baseDir, "exam-main-tests.zip");
  const fallbackZipPath = path.join(baseDir, "exam-fallback-tests.zip");

  await runCommand("tar", ["-a", "-cf", mainZipPath, "-C", mainRoot, "tests"]);
  await runCommand("tar", ["-a", "-cf", fallbackZipPath, "-C", fallbackRoot, "tests"]);

  return {
    mainZipPath,
    fallbackZipPath,
  };
}

function buildMainExamPayload(suffix) {
  return {
    title: `load-main-${suffix}`,
    description: "integration check: mixed questions",
    exam_kind: "quiz",
    target_track_name: QA_TRACK,
    status: "published",
    questions: [
      {
        type: "multiple_choice",
        prompt_md: "2 + 2 = ?",
        required: true,
        choices: ["3", "4", "5"],
        correct_choice_index: 1,
      },
      {
        type: "subjective",
        prompt_md: "간단한 자기소개를 작성하세요.",
        required: true,
      },
      {
        type: "coding",
        prompt_md: "solve(a, b)를 구현해 a+b를 반환하세요.",
        required: true,
      },
    ],
  };
}

function buildFallbackExamPayload(suffix) {
  return {
    title: `load-fallback-${suffix}`,
    description: "integration check: tests fallback path",
    exam_kind: "quiz",
    target_track_name: QA_TRACK,
    status: "published",
    questions: [
      {
        type: "coding",
        prompt_md: "solve(a, b)를 구현해 a+b를 반환하세요.",
        required: true,
      },
    ],
  };
}

function summarizeCodingScores(submissions) {
  const scores = [];
  for (const submission of submissions) {
    const coding = (submission.answers ?? []).find((answer) => answer.question_type === "coding");
    if (coding && typeof coding.grading_score === "number") {
      scores.push(coding.grading_score);
    }
  }
  return scores;
}

async function main() {
  ensure(Number.isInteger(USERS) && USERS >= 10, "VIRTUAL_USERS must be an integer >= 10");

  const suffix = Date.now();
  const report = {
    apiBaseUrl: API_BASE_URL,
    virtualUsers: USERS,
    startedAt: new Date().toISOString(),
  };

  let mainZipPath = MAIN_ZIP_PATH;
  let fallbackZipPath = FALLBACK_ZIP_PATH;
  if (!mainZipPath || !fallbackZipPath) {
    const fixtureDir = path.resolve("tmp", `full-system-check-${suffix}`);
    const fixtures = await createFixtureArchives(fixtureDir);
    mainZipPath = fixtures.mainZipPath;
    fallbackZipPath = fixtures.fallbackZipPath;
    report.fixtureDir = fixtureDir;
  }

  const adminToken = await login("admin", "admin1234");
  const adminMe = await api("GET", "/me", { token: adminToken });
  ensure(adminMe.data?.role === "admin", "admin account role check failed");

  const invalidExamCreate = await api("POST", "/admin/exams", {
    token: adminToken,
    json: {
      title: `invalid-choice-${suffix}`,
      description: "invalid exam payload",
      exam_kind: "quiz",
      target_track_name: QA_TRACK,
      status: "published",
      questions: [
        {
          type: "multiple_choice",
          prompt_md: "invalid question",
          required: true,
          choices: ["A", "B"],
        },
      ],
    },
    expected: [400],
  });
  ensure(
    toErrorDetail(invalidExamCreate.data).includes("정답 번호"),
    "expected validation error for missing correct_choice_index",
  );

  const mainExamCreate = await api("POST", "/admin/exams", {
    token: adminToken,
    json: buildMainExamPayload(suffix),
    expected: [201],
  });
  const mainExam = mainExamCreate.data;
  ensure(mainExam?.id, "main exam creation failed");
  ensure(Array.isArray(mainExam.questions) && mainExam.questions.length === 3, "main exam question count mismatch");

  const mainResource = await uploadExamZip(mainExam.id, adminToken, mainZipPath);
  ensure(mainResource?.id, "main resource upload failed");

  const fallbackExamCreate = await api("POST", "/admin/exams", {
    token: adminToken,
    json: buildFallbackExamPayload(suffix),
    expected: [201],
  });
  const fallbackExam = fallbackExamCreate.data;
  ensure(fallbackExam?.id, "fallback exam creation failed");
  ensure(Array.isArray(fallbackExam.questions) && fallbackExam.questions.length === 1, "fallback exam question count mismatch");

  const fallbackResource = await uploadExamZip(fallbackExam.id, adminToken, fallbackZipPath);
  ensure(fallbackResource?.id, "fallback resource upload failed");

  const republish = await api("POST", `/admin/exams/${mainExam.id}/republish`, {
    token: adminToken,
    json: {
      ...buildMainExamPayload(`${suffix}-republished`),
      copy_resources: true,
    },
    expected: [201],
  });
  ensure(republish.data?.id, "republish failed");
  const republishedExamId = republish.data.id;
  const republishedResources = await api("GET", `/admin/exams/${republishedExamId}/resources`, {
    token: adminToken,
  });
  ensure(Array.isArray(republishedResources.data) && republishedResources.data.length > 0, "republish resource copy check failed");

  const userBase = `vu${String(suffix).slice(-8)}`;
  const users = Array.from({ length: USERS }, (_, idx) => ({
    username: `${userBase}_${String(idx + 1).padStart(2, "0")}`,
    name: `Virtual User ${idx + 1}`,
    track_name: QA_TRACK,
    password: "userpass1234",
  }));
  const outsider = {
    username: `${userBase}_other`,
    name: "Virtual Other",
    track_name: OTHER_TRACK,
    password: "userpass1234",
  };

  const registerStatuses = await Promise.all(users.map((user) => registerUser(user)));
  const outsiderRegister = await registerUser(outsider);
  report.userRegistration = {
    createdOrExisting: registerStatuses.filter((statusCode) => statusCode === 201 || statusCode === 409).length,
    outsiderStatus: outsiderRegister,
  };

  const userTokens = await Promise.all(users.map((user) => login(user.username, user.password)));
  const outsiderToken = await login(outsider.username, outsider.password);

  const outsiderExams = await api("GET", "/exams", { token: outsiderToken });
  ensure(
    Array.isArray(outsiderExams.data) && outsiderExams.data.every((exam) => exam.id !== mainExam.id),
    "track filter check failed: outsider can access QA track exam",
  );

  for (let i = 0; i < users.length; i += 1) {
    const list = await api("GET", "/exams", { token: userTokens[i] });
    const examIds = Array.isArray(list.data) ? list.data.map((item) => item.id) : [];
    ensure(examIds.includes(mainExam.id), `user cannot access main exam: ${users[i].username}`);
    ensure(examIds.includes(fallbackExam.id), `user cannot access fallback exam: ${users[i].username}`);
  }

  const fallbackSubmit = await api("POST", `/exams/${fallbackExam.id}/submit`, {
    token: userTokens[0],
    json: {
      answers: [
        {
          question_id: fallbackExam.questions[0].id,
          answer_text: "def solve(a, b):\n    return a + b\n",
        },
      ],
    },
    expected: [200],
  });
  ensure(fallbackSubmit.data?.submission_id, "fallback submission failed");
  const fallbackAdmin = await waitForAdminSubmissions(fallbackExam.id, adminToken, 1, 120_000);
  const fallbackCoding = fallbackAdmin[0]?.answers?.find((answer) => answer.question_type === "coding");
  ensure(fallbackCoding?.grading_status === "GRADED", "fallback grading status is not GRADED");
  ensure(fallbackCoding?.grading_score === 100, "fallback grading score should be 100");

  const mcqQuestion = mainExam.questions.find((question) => question.type === "multiple_choice");
  const subjectiveQuestion = mainExam.questions.find((question) => question.type === "subjective");
  const codingQuestion = mainExam.questions.find((question) => question.type === "coding");
  ensure(mcqQuestion && subjectiveQuestion && codingQuestion, "main exam question metadata is incomplete");

  const submitResults = await Promise.allSettled(
    users.map((_, idx) => {
      const isCorrectCode = idx < Math.ceil(USERS * 0.66);
      const selectedChoiceIndex = idx % 2 === 0 ? 1 : 0;
      const code = isCorrectCode
        ? "def solve(a, b):\n    return a + b\n"
        : "def solve(a, b):\n    return a - b\n";
      return api("POST", `/exams/${mainExam.id}/submit`, {
        token: userTokens[idx],
        json: {
          answers: [
            {
              question_id: mcqQuestion.id,
              selected_choice_index: selectedChoiceIndex,
            },
            {
              question_id: subjectiveQuestion.id,
              answer_text: `subjective answer from ${users[idx].username}`,
            },
            {
              question_id: codingQuestion.id,
              answer_text: code,
            },
          ],
        },
        expected: [200],
      });
    }),
  );

  const submitSuccessCount = submitResults.filter((result) => result.status === "fulfilled").length;
  ensure(submitSuccessCount === USERS, `main exam submission success mismatch: ${submitSuccessCount}/${USERS}`);

  const duplicateSubmit = await api("POST", `/exams/${mainExam.id}/submit`, {
    token: userTokens[0],
    json: {
      answers: [
        {
          question_id: mcqQuestion.id,
          selected_choice_index: 1,
        },
      ],
    },
    expected: [409],
  });
  ensure(toErrorDetail(duplicateSubmit.data).includes("이미 제출"), "duplicate submit guard failed");

  const mainAdminSubmissions = await waitForAdminSubmissions(mainExam.id, adminToken, USERS, 180_000);
  ensure(mainAdminSubmissions.length >= USERS, "admin submissions count mismatch");

  for (const submission of mainAdminSubmissions) {
    ensure(Array.isArray(submission.answers) && submission.answers.length === 3, "submission answer length mismatch");
    const coding = submission.answers.find((answer) => answer.question_type === "coding");
    ensure(coding?.grading_status === "GRADED", "coding grading_status check failed");
  }

  const scores = summarizeCodingScores(mainAdminSubmissions);
  ensure(scores.length === USERS, "coding scores count mismatch");
  ensure(scores.some((score) => score === 100), "expected at least one perfect coding score");
  ensure(scores.some((score) => score < 100), "expected at least one non-perfect coding score");

  const mainList = await api("GET", "/admin/exams", { token: adminToken });
  const adminExamIds = Array.isArray(mainList.data) ? mainList.data.map((item) => item.id) : [];
  ensure(adminExamIds.includes(mainExam.id), "admin list missing main exam");
  ensure(adminExamIds.includes(republishedExamId), "admin list missing republished exam");

  report.mainExam = {
    id: mainExam.id,
    title: mainExam.title,
    submissions: mainAdminSubmissions.length,
    codingScores: {
      min: Math.min(...scores),
      max: Math.max(...scores),
      average: Number((scores.reduce((acc, score) => acc + score, 0) / scores.length).toFixed(2)),
    },
  };
  report.fallbackExam = {
    id: fallbackExam.id,
    title: fallbackExam.title,
    fallbackGradingStatus: fallbackCoding.grading_status,
    fallbackGradingScore: fallbackCoding.grading_score,
  };
  report.republish = {
    sourceExamId: mainExam.id,
    republishedExamId,
    copiedResourceCount: republishedResources.data.length,
  };
  report.finishedAt = new Date().toISOString();
  report.result = "PASS";

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("[full-system-check] FAIL");
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
