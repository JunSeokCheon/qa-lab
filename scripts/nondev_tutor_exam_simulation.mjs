#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
const TRACK_NAME = process.env.TARGET_TRACK ?? "데이터 분석 11기";
const USERS = Number.parseInt(process.env.VIRTUAL_USERS ?? "30", 10);
const USER_PASSWORD = process.env.USER_PASSWORD ?? "userpass1234";
const DATASET_ZIP_PATH =
  process.env.DATASET_ZIP_PATH ?? "C:/Users/tlsdy/Downloads/seoul_real_estate_dataset.zip";
const ASSIGNMENT_PDF_PATH = process.env.ASSIGNMENT_PDF_PATH ?? "C:/Users/tlsdy/Downloads/개인 과제.pdf";
const ANSWER_NOTEBOOK_PATH =
  process.env.ANSWER_NOTEBOOK_PATH ?? "C:/Users/tlsdy/Downloads/베이직반_과제_모범답안.ipynb";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function ensure(value, message) {
  if (!value) {
    throw new Error(message);
  }
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
      `${method} ${route} failed: status=${response.status} expected=${expected.join(",")} detail=${toErrorDetail(payload)}`
    );
  }

  return { status: response.status, data: payload };
}

async function login(username, password) {
  const result = await api("POST", "/auth/login", { json: { username, password }, expected: [200] });
  ensure(result.data?.access_token, `missing access token: ${username}`);
  return result.data.access_token;
}

async function registerUser(user) {
  return api("POST", "/auth/register", { json: user, expected: [201, 409] });
}

async function assertFileExists(filePath) {
  const absolute = path.resolve(filePath);
  try {
    const stat = await fs.stat(absolute);
    ensure(stat.isFile(), `not a file: ${absolute}`);
    return absolute;
  } catch {
    throw new Error(`missing file: ${absolute}`);
  }
}

async function uploadResource(examId, token, filePath) {
  const absolute = path.resolve(filePath);
  const bytes = await fs.readFile(absolute);
  const form = new FormData();
  form.append("file", new Blob([bytes]), path.basename(absolute));
  return api("POST", `/admin/exams/${examId}/resources`, {
    token,
    body: form,
    expected: [201],
  });
}

async function waitForExamSubmissionsSettled(examId, token, expectedCount, timeoutMs = 900_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await api("GET", `/admin/exams/${examId}/submissions`, { token, expected: [200] });
    const submissions = Array.isArray(result.data) ? result.data : [];
    const inFlight = submissions.filter((row) => ["QUEUED", "RUNNING"].includes(row.status)).length;
    if (submissions.length >= expectedCount && inFlight === 0) {
      return submissions;
    }
    await sleep(2_000);
  }
  throw new Error(`timeout waiting submissions exam_id=${examId} expected=${expectedCount}`);
}

async function waitForSelectedSubmissionsSettled(examId, submissionIds, token, timeoutMs = 300_000) {
  const targetIds = new Set(submissionIds);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await api("GET", `/admin/exams/${examId}/submissions`, { token, expected: [200] });
    const submissions = Array.isArray(result.data) ? result.data : [];
    const byId = new Map(submissions.map((item) => [item.submission_id, item]));
    let done = true;
    for (const id of targetIds) {
      const row = byId.get(id);
      if (!row || ["QUEUED", "RUNNING"].includes(row.status)) {
        done = false;
        break;
      }
    }
    if (done) return submissions;
    await sleep(2_000);
  }
  throw new Error(`timeout waiting regrade targets: ${Array.from(targetIds).join(", ")}`);
}

const CODE_Q9 = {
  perfect: [
    "import pandas as pd",
    "",
    "def load_head(csv_path):",
    "    df = pd.read_csv(csv_path, encoding='cp949')",
    "    return df.head(5)",
    "",
  ].join("\n"),
  good: [
    "import pandas as pd",
    "",
    "def load_head(csv_path):",
    "    df = pd.read_csv(csv_path)",
    "    return df.head()",
    "",
  ].join("\n"),
  low: [
    "import pandas as pd",
    "",
    "def load_head(csv_path):",
    "    return pd.read_csv(csv_path).iloc[:3]",
    "",
  ].join("\n"),
  zero: [
    "def load_head(csv_path):",
    "    return []",
    "",
  ].join("\n"),
};

const CODE_Q10 = {
  perfect: [
    "def mean_price_per_sqm(df):",
    "    ratios = []",
    "    for _, row in df.iterrows():",
    "        try:",
    "            amount = float(str(row['물건금액(만원)']).replace(',', '').strip())",
    "            area = float(str(row['건물면적(㎡)']).replace(',', '').strip())",
    "        except Exception:",
    "            continue",
    "        if area <= 0:",
    "            continue",
    "        ratios.append(amount / area)",
    "    return round(sum(ratios) / len(ratios), 2) if ratios else 0.0",
    "",
  ].join("\n"),
  good: [
    "def mean_price_per_sqm(df):",
    "    values = []",
    "    for _, row in df.iterrows():",
    "        amount = float(str(row['물건금액(만원)']).replace(',', ''))",
    "        area = float(str(row['건물면적(㎡)']).replace(',', ''))",
    "        if area <= 0:",
    "            continue",
    "        values.append(amount / area)",
    "    return round(sum(values) / len(values), 2) if values else 0.0",
    "",
  ].join("\n"),
  low: [
    "def mean_price_per_sqm(df):",
    "    total = 0.0",
    "    for _, row in df.iterrows():",
    "        total += float(str(row['물건금액(만원)']).replace(',', ''))",
    "    return round(total, 2)",
    "",
  ].join("\n"),
  zero: [
    "def mean_price_per_sqm(df):",
    "    return 0.0",
    "",
  ].join("\n"),
};

function buildExamPayload(suffix) {
  return {
    title: `비개발자 튜터 시나리오 시험-${suffix}`,
    description:
      "튜터가 코드 테스트를 작성하지 않고 정답/채점 기준만 입력해 운영하는 자동 채점 시험 (객관식+주관식+코딩)",
    exam_kind: "assessment",
    target_track_name: TRACK_NAME,
    status: "published",
    questions: [
      {
        type: "multiple_choice",
        prompt_md: "문제1) 3개 연도 CSV를 행 방향으로 합치는 가장 적절한 pandas 코드는?",
        required: true,
        choices: [
          "pd.concat([df2022, df2023, df2024], axis=0, ignore_index=True)",
          "pd.concat([df2022, df2023, df2024], axis=1)",
          "pd.merge(df2022, df2023, on='계약일')",
          "df2022.append(df2023, df2024)",
        ],
        correct_choice_index: 0,
      },
      {
        type: "multiple_choice",
        prompt_md: "문제2) 중복 제거 시 계약번호 컬럼 기준으로 마지막 값 유지 코드는?",
        required: true,
        choices: [
          "df.drop_duplicates()",
          "df.drop_duplicates(subset=['계약번호'], keep='last')",
          "df.dropna(subset=['계약번호'])",
          "df.unique('계약번호')",
        ],
        correct_choice_index: 1,
      },
      {
        type: "multiple_choice",
        prompt_md: "문제3) 수치형 결측치를 중앙값으로 대체할 때 적절한 코드는?",
        required: true,
        choices: [
          "df[col] = df[col].fillna(df[col].median())",
          "df[col] = df[col].fillna(df[col].mean(axis=1))",
          "df[col] = df[col].dropna()",
          "df[col] = 0",
        ],
        correct_choice_index: 0,
      },
      {
        type: "multiple_choice",
        prompt_md: "문제4) 자치구별 평균 거래금액 비교 시 가장 직관적인 시각화는?",
        required: true,
        choices: ["히스토그램", "막대그래프(bar plot)", "산점도", "박스플롯(전체 1개)"],
        correct_choice_index: 1,
      },
      {
        type: "multiple_choice",
        prompt_md: "문제5) 두 독립 집단이 비정규 분포일 때 차이 검정으로 적절한 것은?",
        required: true,
        choices: ["독립표본 t-검정", "Mann-Whitney U 검정", "카이제곱 검정", "피어슨 상관분석"],
        correct_choice_index: 1,
      },
      {
        type: "multiple_choice",
        prompt_md: "문제6) 두 범주형 변수의 독립성 검정에 사용하는 방법은?",
        required: true,
        choices: ["카이제곱 검정", "선형회귀", "Shapiro-Wilk", "ANOVA"],
        correct_choice_index: 0,
      },
      {
        type: "subjective",
        prompt_md: "문제7) train 데이터로만 전처리 기준을 맞춰야 하는 이유를 한 단어로 작성하세요.",
        required: true,
        answer_key_text: "데이터누수방지",
      },
      {
        type: "subjective",
        prompt_md: "문제8) p-value가 0.01이고 유의수준 0.05일 때 결론을 한 단어로 작성하세요.",
        required: true,
        answer_key_text: "귀무가설기각",
      },
      {
        type: "coding",
        prompt_md: [
          "문제9) 아래 함수를 구현하세요.",
          "```python",
          "def load_head(csv_path):",
          "    \"\"\"",
          "    csv_path 파일을 pandas로 읽어 상위 5행(DataFrame)을 반환하세요.",
          "    \"\"\"",
          "```",
        ].join("\n"),
        required: true,
        answer_key_text: CODE_Q9.perfect,
      },
      {
        type: "coding",
        prompt_md: [
          "문제10) 아래 함수를 구현하세요.",
          "```python",
          "def mean_price_per_sqm(df):",
          "    \"\"\"",
          "    df의 물건금액(만원)/건물면적(㎡) 평균을 소수 둘째자리로 반환하세요.",
          "    숫자 변환 불가 값과 면적<=0은 제외하고, 유효 행이 없으면 0.0 반환.",
          "    \"\"\"",
          "```",
        ].join("\n"),
        required: true,
        answer_key_text: CODE_Q10.perfect,
      },
    ],
  };
}

function wrongChoice(correctIndex, choiceCount) {
  return (correctIndex + 1) % choiceCount;
}

function buildAnswers(profile, ids) {
  const mcqCorrect = { q1: 0, q2: 1, q3: 0, q4: 1, q5: 1, q6: 0 };
  const mcqChoices = { q1: 4, q2: 4, q3: 4, q4: 4, q5: 4, q6: 4 };

  const selected = {
    q1: wrongChoice(mcqCorrect.q1, mcqChoices.q1),
    q2: wrongChoice(mcqCorrect.q2, mcqChoices.q2),
    q3: wrongChoice(mcqCorrect.q3, mcqChoices.q3),
    q4: wrongChoice(mcqCorrect.q4, mcqChoices.q4),
    q5: wrongChoice(mcqCorrect.q5, mcqChoices.q5),
    q6: wrongChoice(mcqCorrect.q6, mcqChoices.q6),
  };

  let s7 = "모름";
  let s8 = "모름";
  let c9 = CODE_Q9.zero;
  let c10 = CODE_Q10.zero;

  if (profile === "elite") {
    selected.q1 = mcqCorrect.q1;
    selected.q2 = mcqCorrect.q2;
    selected.q3 = mcqCorrect.q3;
    selected.q4 = mcqCorrect.q4;
    selected.q5 = mcqCorrect.q5;
    selected.q6 = mcqCorrect.q6;
    s7 = "데이터누수방지";
    s8 = "귀무가설기각";
    c9 = CODE_Q9.perfect;
    c10 = CODE_Q10.perfect;
  } else if (profile === "high") {
    selected.q1 = mcqCorrect.q1;
    selected.q2 = mcqCorrect.q2;
    selected.q3 = mcqCorrect.q3;
    selected.q4 = mcqCorrect.q4;
    selected.q5 = wrongChoice(mcqCorrect.q5, mcqChoices.q5);
    selected.q6 = mcqCorrect.q6;
    s7 = "데이터 누수 방지";
    s8 = "귀무가설기각";
    c9 = CODE_Q9.good;
    c10 = CODE_Q10.perfect;
  } else if (profile === "mid") {
    selected.q1 = mcqCorrect.q1;
    selected.q2 = wrongChoice(mcqCorrect.q2, mcqChoices.q2);
    selected.q3 = mcqCorrect.q3;
    selected.q4 = wrongChoice(mcqCorrect.q4, mcqChoices.q4);
    selected.q5 = mcqCorrect.q5;
    selected.q6 = wrongChoice(mcqCorrect.q6, mcqChoices.q6);
    s7 = "데이터 누수 방지";
    s8 = "기각";
    c9 = CODE_Q9.good;
    c10 = CODE_Q10.good;
  } else if (profile === "low") {
    selected.q1 = wrongChoice(mcqCorrect.q1, mcqChoices.q1);
    selected.q2 = mcqCorrect.q2;
    selected.q3 = wrongChoice(mcqCorrect.q3, mcqChoices.q3);
    selected.q4 = wrongChoice(mcqCorrect.q4, mcqChoices.q4);
    selected.q5 = mcqCorrect.q5;
    selected.q6 = wrongChoice(mcqCorrect.q6, mcqChoices.q6);
    s7 = "과적합방지";
    s8 = "귀무가설채택";
    c9 = CODE_Q9.low;
    c10 = CODE_Q10.low;
  } else if (profile === "mixed") {
    selected.q1 = mcqCorrect.q1;
    selected.q2 = wrongChoice(mcqCorrect.q2, mcqChoices.q2);
    selected.q3 = wrongChoice(mcqCorrect.q3, mcqChoices.q3);
    selected.q4 = mcqCorrect.q4;
    selected.q5 = wrongChoice(mcqCorrect.q5, mcqChoices.q5);
    selected.q6 = mcqCorrect.q6;
    s7 = "데이터누수방지";
    s8 = "귀무가설기각";
    c9 = CODE_Q9.perfect;
    c10 = CODE_Q10.low;
  } else if (profile === "weak") {
    selected.q1 = wrongChoice(mcqCorrect.q1, mcqChoices.q1);
    selected.q2 = wrongChoice(mcqCorrect.q2, mcqChoices.q2);
    selected.q3 = wrongChoice(mcqCorrect.q3, mcqChoices.q3);
    selected.q4 = wrongChoice(mcqCorrect.q4, mcqChoices.q4);
    selected.q5 = wrongChoice(mcqCorrect.q5, mcqChoices.q5);
    selected.q6 = wrongChoice(mcqCorrect.q6, mcqChoices.q6);
    s7 = "모름";
    s8 = "모름";
    c9 = CODE_Q9.zero;
    c10 = CODE_Q10.zero;
  }

  return [
    { question_id: ids.q1, selected_choice_index: selected.q1 },
    { question_id: ids.q2, selected_choice_index: selected.q2 },
    { question_id: ids.q3, selected_choice_index: selected.q3 },
    { question_id: ids.q4, selected_choice_index: selected.q4 },
    { question_id: ids.q5, selected_choice_index: selected.q5 },
    { question_id: ids.q6, selected_choice_index: selected.q6 },
    { question_id: ids.q7, answer_text: s7 },
    { question_id: ids.q8, answer_text: s8 },
    { question_id: ids.q9, answer_text: c9 },
    { question_id: ids.q10, answer_text: c10 },
  ];
}

function scoreSubmission(submission) {
  const answers = Array.isArray(submission.answers) ? submission.answers : [];
  let maxPoints = 0;
  let earned = 0;
  for (const answer of answers) {
    if (answer.question_type === "multiple_choice") {
      maxPoints += 1;
      if (
        typeof answer.correct_choice_index === "number" &&
        typeof answer.selected_choice_index === "number" &&
        answer.correct_choice_index === answer.selected_choice_index
      ) {
        earned += 1;
      }
      continue;
    }

    maxPoints += 1;
    if (typeof answer.grading_score === "number" && typeof answer.grading_max_score === "number" && answer.grading_max_score > 0) {
      earned += answer.grading_score / answer.grading_max_score;
    }
  }
  const percent = maxPoints > 0 ? Number(((earned / maxPoints) * 100).toFixed(2)) : 0;
  return { earned, maxPoints, percent };
}

function bandLabel(percent) {
  if (percent >= 90) return "90-100";
  if (percent >= 80) return "80-89";
  if (percent >= 70) return "70-79";
  if (percent >= 60) return "60-69";
  if (percent >= 50) return "50-59";
  return "0-49";
}

async function main() {
  ensure(Number.isInteger(USERS) && USERS >= 30, "VIRTUAL_USERS must be an integer >= 30");

  const datasetZip = await assertFileExists(DATASET_ZIP_PATH);
  const assignmentPdf = await assertFileExists(ASSIGNMENT_PDF_PATH);
  const answerNotebook = await assertFileExists(ANSWER_NOTEBOOK_PATH);

  const suffix = Date.now();
  const adminToken = await login("admin", "admin1234");
  const me = await api("GET", "/me", { token: adminToken, expected: [200] });
  ensure(me.data?.role === "admin", "admin login failed");

  const createExam = await api("POST", "/admin/exams", {
    token: adminToken,
    json: buildExamPayload(suffix),
    expected: [201],
  });
  const exam = createExam.data;
  ensure(exam?.id, "exam creation failed");
  ensure(Array.isArray(exam.questions) && exam.questions.length === 10, "question count mismatch");

  const uploadResults = [];
  uploadResults.push(await uploadResource(exam.id, adminToken, datasetZip));
  uploadResults.push(await uploadResource(exam.id, adminToken, assignmentPdf));
  uploadResults.push(await uploadResource(exam.id, adminToken, answerNotebook));

  const questionByOrder = new Map(exam.questions.map((question) => [question.order_index, question]));
  const ids = {
    q1: questionByOrder.get(1)?.id,
    q2: questionByOrder.get(2)?.id,
    q3: questionByOrder.get(3)?.id,
    q4: questionByOrder.get(4)?.id,
    q5: questionByOrder.get(5)?.id,
    q6: questionByOrder.get(6)?.id,
    q7: questionByOrder.get(7)?.id,
    q8: questionByOrder.get(8)?.id,
    q9: questionByOrder.get(9)?.id,
    q10: questionByOrder.get(10)?.id,
  };
  ensure(Object.values(ids).every(Boolean), "failed to resolve question ids");

  const userPrefix = `nontutor_${String(suffix).slice(-8)}`;
  const users = Array.from({ length: USERS }, (_, idx) => ({
    username: `${userPrefix}_${String(idx + 1).padStart(2, "0")}`,
    name: `튜터시나리오 유저 ${idx + 1}`,
    track_name: TRACK_NAME,
    password: USER_PASSWORD,
  }));
  const profiles = ["elite", "high", "mid", "low", "mixed", "weak"];

  const registerStatuses = await Promise.all(users.map((user) => registerUser(user)));
  const loginTokens = await Promise.all(users.map((user) => login(user.username, user.password)));

  const examChecks = await Promise.all(
    loginTokens.map((token) =>
      api("GET", "/exams", {
        token,
        expected: [200],
      })
    )
  );
  for (const check of examChecks) {
    const idsInList = Array.isArray(check.data) ? check.data.map((row) => row.id) : [];
    ensure(idsInList.includes(exam.id), `exam is not visible to one of the virtual users: exam_id=${exam.id}`);
  }

  const submitResults = await Promise.allSettled(
    loginTokens.map((token, idx) =>
      api("POST", `/exams/${exam.id}/submit`, {
        token,
        json: {
          answers: buildAnswers(profiles[idx % profiles.length], ids),
        },
        expected: [200],
      })
    )
  );
  const submitSuccess = submitResults.filter((row) => row.status === "fulfilled").length;
  ensure(submitSuccess === USERS, `submission success mismatch: ${submitSuccess}/${USERS}`);

  const gradingCandidates = await api("GET", `/admin/grading/exam-submissions?exam_id=${exam.id}&coding_only=true&limit=500`, {
    token: adminToken,
    expected: [200],
  });
  const queueTargets = Array.isArray(gradingCandidates.data)
    ? gradingCandidates.data
        .filter((row) => !["QUEUED", "RUNNING"].includes(String(row.status)))
        .map((row) => row.submission_id)
    : [];
  ensure(queueTargets.length === USERS, `approval queue target mismatch: ${queueTargets.length}/${USERS}`);

  for (const submissionId of queueTargets) {
    await api("POST", `/admin/grading/exam-submissions/${submissionId}/enqueue`, {
      token: adminToken,
      json: { force: false },
      expected: [200],
    });
  }

  const submissions = await waitForExamSubmissionsSettled(exam.id, adminToken, USERS, 900_000);
  ensure(submissions.length >= USERS, `admin submissions mismatch: ${submissions.length}/${USERS}`);

  const q9Scores = [];
  const q10Scores = [];
  const overallPercents = [];
  const submissionStatusSummary = {};
  const scoreBandSummary = {};

  for (const submission of submissions) {
    submissionStatusSummary[submission.status] = (submissionStatusSummary[submission.status] ?? 0) + 1;
    const scored = scoreSubmission(submission);
    overallPercents.push(scored.percent);
    const band = bandLabel(scored.percent);
    scoreBandSummary[band] = (scoreBandSummary[band] ?? 0) + 1;

    const q9 = submission.answers.find((answer) => answer.question_order === 9);
    const q10 = submission.answers.find((answer) => answer.question_order === 10);
    if (typeof q9?.grading_score === "number") q9Scores.push(q9.grading_score);
    if (typeof q10?.grading_score === "number") q10Scores.push(q10.grading_score);
  }

  ensure(q9Scores.length === USERS, `coding q9 score count mismatch: ${q9Scores.length}/${USERS}`);
  ensure(q10Scores.length === USERS, `coding q10 score count mismatch: ${q10Scores.length}/${USERS}`);
  ensure(new Set(q9Scores).size >= 2, "q9 coding score diversity is too low");
  ensure(new Set(q10Scores).size >= 2, "q10 coding score diversity is too low");
  ensure(new Set(overallPercents).size >= 4, "overall score diversity is too low");

  const regradeTargetIds = submissions.slice(0, 3).map((item) => item.submission_id);
  for (const submissionId of regradeTargetIds) {
    await api("POST", `/admin/grading/exam-submissions/${submissionId}/enqueue`, {
      token: adminToken,
      json: { force: true },
      expected: [200],
    });
  }
  const afterRegrade = await waitForSelectedSubmissionsSettled(exam.id, regradeTargetIds, adminToken, 300_000);
  for (const submissionId of regradeTargetIds) {
    const row = afterRegrade.find((item) => item.submission_id === submissionId);
    ensure(row && !["QUEUED", "RUNNING"].includes(row.status), `regrade did not finish: ${submissionId}`);
  }

  const sampleReasonRows = submissions.slice(0, 3).map((submission) => {
    const subjective = submission.answers.find((answer) => answer.question_order === 7);
    const coding = submission.answers.find((answer) => answer.question_order === 9);
    return {
      submission_id: submission.submission_id,
      user_name: submission.user_name,
      subjective_reason:
        typeof subjective?.grading_feedback_json?.reason === "string"
          ? subjective.grading_feedback_json.reason
          : (subjective?.grading_feedback_json?.error ?? null),
      coding_reason:
        typeof coding?.grading_feedback_json?.reason === "string"
          ? coding.grading_feedback_json.reason
          : (coding?.grading_feedback_json?.error ?? null),
    };
  });

  const sum = (list) => list.reduce((acc, value) => acc + value, 0);
  const report = {
    result: "PASS",
    apiBaseUrl: API_BASE_URL,
    exam: {
      id: exam.id,
      title: exam.title,
      targetTrack: TRACK_NAME,
      questionCount: exam.questions.length,
      resourceIds: uploadResults.map((item) => item.data?.id).filter(Boolean),
    },
    users: {
      requested: USERS,
      submitted: submitSuccess,
      registerStatusSummary: registerStatuses.reduce((acc, row) => {
        const key = String(row.status);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },
    grading: {
      submissionStatusSummary,
      scoreBandSummary,
      codingQ9: {
        min: Math.min(...q9Scores),
        max: Math.max(...q9Scores),
        avg: Number((sum(q9Scores) / q9Scores.length).toFixed(2)),
        unique: Array.from(new Set(q9Scores)).sort((a, b) => a - b),
      },
      codingQ10: {
        min: Math.min(...q10Scores),
        max: Math.max(...q10Scores),
        avg: Number((sum(q10Scores) / q10Scores.length).toFixed(2)),
        unique: Array.from(new Set(q10Scores)).sort((a, b) => a - b),
      },
      overallPercent: {
        min: Math.min(...overallPercents),
        max: Math.max(...overallPercents),
        avg: Number((sum(overallPercents) / overallPercents.length).toFixed(2)),
        uniqueCount: new Set(overallPercents).size,
      },
      sampleReasonRows,
    },
    files: {
      datasetZip,
      assignmentPdf,
      answerNotebook,
    },
    regrade: {
      targets: regradeTargetIds,
      completed: true,
    },
    timestamps: {
      finishedAt: new Date().toISOString(),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("[nondev-tutor-exam-simulation] FAIL");
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
