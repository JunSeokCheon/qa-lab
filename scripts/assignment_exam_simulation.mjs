#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

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
  const result = await api("POST", "/auth/login", { json: { username, password }, expected: [200] });
  ensure(result.data?.access_token, `missing access token: ${username}`);
  return result.data.access_token;
}

async function registerUser(user) {
  return api("POST", "/auth/register", { json: user, expected: [201, 409] });
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

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function waitForExamSubmissionsSettled(examId, token, expectedCount, timeoutMs = 600_000) {
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

async function waitForSelectedSubmissionsSettled(examId, submissionIds, token, timeoutMs = 240_000) {
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

async function createTestsArchive(baseDir) {
  const root = path.join(baseDir, "grading-fixture");
  const q7PublicDir = path.join(root, "tests", "question_7", "public");
  const q7HiddenDir = path.join(root, "tests", "question_7", "hidden");
  const q8PublicDir = path.join(root, "tests", "question_8", "public");
  const q8HiddenDir = path.join(root, "tests", "question_8", "hidden");
  await fs.mkdir(q7PublicDir, { recursive: true });
  await fs.mkdir(q7HiddenDir, { recursive: true });
  await fs.mkdir(q8PublicDir, { recursive: true });
  await fs.mkdir(q8HiddenDir, { recursive: true });

  const q7Helper = [
    "import math",
    "",
    "def percentile_linear(sorted_values, p):",
    "    if not sorted_values:",
    "        return 0.0",
    "    if len(sorted_values) == 1:",
    "        return float(sorted_values[0])",
    "    k = (len(sorted_values) - 1) * (p / 100.0)",
    "    f = math.floor(k)",
    "    c = math.ceil(k)",
    "    if f == c:",
    "        return float(sorted_values[f])",
    "    return float(sorted_values[f] * (c - k) + sorted_values[c] * (k - f))",
    "",
    "def expected_iqr_outlier_count(values):",
    "    vals = sorted(float(v) for v in values)",
    "    if len(vals) < 4:",
    "        return 0",
    "    q1 = percentile_linear(vals, 25)",
    "    q3 = percentile_linear(vals, 75)",
    "    iqr = q3 - q1",
    "    lo = q1 - 1.5 * iqr",
    "    hi = q3 + 1.5 * iqr",
    "    return sum(1 for v in vals if v < lo or v > hi)",
    "",
  ].join("\n");

  await fs.writeFile(path.join(root, "tests", "question_7", "helper.py"), q7Helper, "utf-8");

  await fs.writeFile(
    path.join(q7PublicDir, "test_iqr_public.py"),
    [
      "from solution import iqr_outlier_count",
      "from tests.question_7.helper import expected_iqr_outlier_count",
      "",
      "def test_empty_values() -> None:",
      "    assert iqr_outlier_count([]) == 0",
      "",
      "def test_basic_outlier_case() -> None:",
      "    values = [10, 11, 12, 13, 99]",
      "    assert iqr_outlier_count(values) == expected_iqr_outlier_count(values)",
      "",
    ].join("\n"),
    "utf-8",
  );

  await fs.writeFile(
    path.join(q7HiddenDir, "test_iqr_hidden.py"),
    [
      "from solution import iqr_outlier_count",
      "from tests.question_7.helper import expected_iqr_outlier_count",
      "",
      "def test_no_outlier_case() -> None:",
      "    values = [101, 102, 103, 104, 105]",
      "    assert iqr_outlier_count(values) == expected_iqr_outlier_count(values)",
      "",
      "def test_negative_values_case() -> None:",
      "    values = [-12, -11, -10, -9, 45]",
      "    assert iqr_outlier_count(values) == expected_iqr_outlier_count(values)",
      "",
    ].join("\n"),
    "utf-8",
  );

  await fs.writeFile(
    path.join(q8PublicDir, "test_mean_price_public.py"),
    [
      "import csv",
      "from pathlib import Path",
      "",
      "from solution import mean_price_per_sqm",
      "",
      "ROOT = Path(__file__).resolve().parents[3]",
      "DATASET_SOURCE = ROOT / 'seoul_real_estate_dataset' / '2024.csv'",
      "SAMPLE_PATH = ROOT / 'tests' / 'question_8' / 'sample_2024.csv'",
      "",
      "def _ensure_sample_file() -> Path:",
      "    assert DATASET_SOURCE.exists(), f'missing dataset source: {DATASET_SOURCE}'",
      "    if SAMPLE_PATH.exists():",
      "        return SAMPLE_PATH",
      "    with open(DATASET_SOURCE, 'r', encoding='cp949', newline='') as src, open(",
      "        SAMPLE_PATH, 'w', encoding='cp949', newline=''",
      "    ) as dst:",
      "        reader = csv.DictReader(src)",
      "        writer = csv.DictWriter(dst, fieldnames=reader.fieldnames)",
      "        writer.writeheader()",
      "        for idx, row in enumerate(reader):",
      "            if idx >= 1200:",
      "                break",
      "            writer.writerow(row)",
      "    return SAMPLE_PATH",
      "",
      "def _expected_mean(csv_path: Path, gu_name: str) -> float:",
      "    target = gu_name.strip()",
      "    total = 0.0",
      "    count = 0",
      "    with open(csv_path, 'r', encoding='cp949', newline='') as f:",
      "        reader = csv.DictReader(f)",
      "        for row in reader:",
      "            if (row.get('자치구명') or '').strip() != target:",
      "                continue",
      "            amount_raw = (row.get('물건금액(만원)') or '').replace(',', '').strip()",
      "            area_raw = (row.get('건물면적(㎡)') or '').replace(',', '').strip()",
      "            try:",
      "                amount = float(amount_raw)",
      "                area = float(area_raw)",
      "            except Exception:",
      "                continue",
      "            if area <= 0:",
      "                continue",
      "            total += amount / area",
      "            count += 1",
      "    return round(total / count, 2) if count else 0.0",
      "",
      "def test_mean_price_gangnam() -> None:",
      "    sample_path = _ensure_sample_file()",
      "    expected = _expected_mean(sample_path, '강남구')",
      "    assert mean_price_per_sqm(str(sample_path), '강남구') == expected",
      "",
      "def test_mean_price_no_rows() -> None:",
      "    sample_path = _ensure_sample_file()",
      "    assert mean_price_per_sqm(str(sample_path), '가상구') == 0.0",
      "",
    ].join("\n"),
    "utf-8",
  );

  await fs.writeFile(
    path.join(q8HiddenDir, "test_mean_price_hidden.py"),
    [
      "from tests.question_8.public.test_mean_price_public import _ensure_sample_file, _expected_mean",
      "from solution import mean_price_per_sqm",
      "",
      "def test_mean_price_gangseo() -> None:",
      "    sample_path = _ensure_sample_file()",
      "    expected = _expected_mean(sample_path, '강서구')",
      "    assert mean_price_per_sqm(str(sample_path), '강서구') == expected",
      "",
      "def test_mean_price_trimmed_gu_name() -> None:",
      "    sample_path = _ensure_sample_file()",
      "    expected = _expected_mean(sample_path, '강서구')",
      "    assert mean_price_per_sqm(str(sample_path), ' 강서구 ') == expected",
      "",
    ].join("\n"),
    "utf-8",
  );

  const zipPath = path.join(baseDir, "assignment-tests.zip");
  await runCommand("tar", ["-a", "-cf", zipPath, "-C", root, "tests"]);
  return zipPath;
}

function buildExamPayload(suffix) {
  return {
    title: `개인과제 기반 QA 시험-${suffix}`,
    description: "데이터 전처리/시각화/통계 + 코딩 자동채점 시험",
    exam_kind: "assessment",
    target_track_name: TRACK_NAME,
    status: "published",
    questions: [
      {
        type: "multiple_choice",
        prompt_md:
          "문제1) 2022~2024 CSV를 행 방향으로 결합할 때 올바른 pandas 코드는 무엇인가?",
        required: true,
        choices: [
          "pd.concat([df2022, df2023, df2024], axis=0, ignore_index=True)",
          "pd.concat([df2022, df2023, df2024], axis=1)",
          "pd.merge(df2022, df2023, on='계약일')",
          "df2022.join(df2023).join(df2024)",
        ],
        correct_choice_index: 0,
      },
      {
        type: "multiple_choice",
        prompt_md: "문제2) 모범답안 기준 IQR 방식으로 제거된 물건금액 이상치 행 개수는?",
        required: true,
        choices: ["52,347", "53,547", "54,047", "55,547"],
        correct_choice_index: 1,
      },
      {
        type: "multiple_choice",
        prompt_md: "문제3) 자치구명-건물용도 Cramer's V (소수 둘째자리 반올림)는?",
        required: true,
        choices: ["0.12", "0.22", "0.58", "0.82"],
        correct_choice_index: 1,
      },
      {
        type: "multiple_choice",
        prompt_md: "문제4) 강서구 vs 동작구 물건금액 비교(비정규)에서 적절한 검정은?",
        required: true,
        choices: ["독립표본 t-검정", "카이제곱 검정", "Mann-Whitney U 검정", "일원분산분석(ANOVA)"],
        correct_choice_index: 2,
      },
      {
        type: "subjective",
        prompt_md: "문제5) train 데이터에서만 경계를 fit해야 하는 이유를 한 단어로 작성하세요.",
        required: true,
        answer_key_text: "데이터누수방지",
      },
      {
        type: "subjective",
        prompt_md: "문제6) p-value=0.0, 유의수준 0.05일 때 결론을 한 단어로 작성하세요.",
        required: true,
        answer_key_text: "귀무가설기각",
      },
      {
        type: "coding",
        prompt_md: [
          "문제7) 아래 함수를 구현하세요.",
          "```python",
          "def iqr_outlier_count(values):",
          "    \"\"\"",
          "    values(list[float|int])에서 IQR 기준 이상치 개수를 int로 반환",
          "    (q1-1.5*iqr 미만 또는 q3+1.5*iqr 초과)",
          "    \"\"\"",
          "```",
        ].join("\n"),
        required: true,
        answer_key_text: CODE_Q7.perfect,
      },
      {
        type: "coding",
        prompt_md: [
          "문제8) 아래 함수를 구현하세요.",
          "```python",
          "def mean_price_per_sqm(csv_path, gu_name):",
          "    \"\"\"",
          "    cp949 CSV를 읽어, 자치구명==gu_name 인 행의 평균(물건금액(만원)/건물면적(㎡))을 반환",
          "    반올림 소수 둘째자리, 해당 행이 없으면 0.0",
          "    \"\"\"",
          "```",
        ].join("\n"),
        required: true,
        answer_key_text: CODE_Q8.perfect,
      },
    ],
  };
}

const CODE_Q7 = {
  perfect: [
    "def iqr_outlier_count(values):",
    "    import math",
    "    vals = sorted(float(v) for v in values)",
    "    if len(vals) < 4:",
    "        return 0",
    "    def pct(p):",
    "        k = (len(vals) - 1) * (p / 100.0)",
    "        f = math.floor(k)",
    "        c = math.ceil(k)",
    "        if f == c:",
    "            return vals[f]",
    "        return vals[f] * (c - k) + vals[c] * (k - f)",
    "    q1 = pct(25)",
    "    q3 = pct(75)",
    "    iqr = q3 - q1",
    "    lo = q1 - 1.5 * iqr",
    "    hi = q3 + 1.5 * iqr",
    "    return sum(1 for v in vals if v < lo or v > hi)",
    "",
  ].join("\n"),
  p75: [
    "def iqr_outlier_count(values):",
    "    if not values:",
    "        return 0",
    "    vals = [float(v) for v in values]",
    "    return 1 if (max(vals) - min(vals)) > 50 else 0",
    "",
  ].join("\n"),
  p50: [
    "def iqr_outlier_count(values):",
    "    return 0",
    "",
  ].join("\n"),
  zero: [
    "def iqr_outlier_count(values):",
    "    return -1",
    "",
  ].join("\n"),
};

const CODE_Q8 = {
  perfect: [
    "import csv",
    "",
    "def mean_price_per_sqm(csv_path, gu_name):",
    "    target = (gu_name or '').strip()",
    "    if not target:",
    "        return 0.0",
    "    total = 0.0",
    "    count = 0",
    "    with open(csv_path, 'r', encoding='cp949', newline='') as f:",
    "        reader = csv.DictReader(f)",
    "        for row in reader:",
    "            if (row.get('자치구명') or '').strip() != target:",
    "                continue",
    "            amount_raw = (row.get('물건금액(만원)') or '').replace(',', '').strip()",
    "            area_raw = (row.get('건물면적(㎡)') or '').replace(',', '').strip()",
    "            try:",
    "                amount = float(amount_raw)",
    "                area = float(area_raw)",
    "            except Exception:",
    "                continue",
    "            if area <= 0:",
    "                continue",
    "            total += amount / area",
    "            count += 1",
    "    return round(total / count, 2) if count else 0.0",
    "",
  ].join("\n"),
  p75: [
    "import csv",
    "",
    "def mean_price_per_sqm(csv_path, gu_name):",
    "    target = gu_name",
    "    total = 0.0",
    "    count = 0",
    "    with open(csv_path, 'r', encoding='cp949', newline='') as f:",
    "        for row in csv.DictReader(f):",
    "            if (row.get('자치구명') or '').strip() != target:",
    "                continue",
    "            try:",
    "                amount = float((row.get('물건금액(만원)') or '0').replace(',', ''))",
    "                area = float((row.get('건물면적(㎡)') or '0').replace(',', ''))",
    "            except Exception:",
    "                continue",
    "            if area <= 0:",
    "                continue",
    "            total += amount / area",
    "            count += 1",
    "    return round(total / count, 2) if count else 0.0",
    "",
  ].join("\n"),
  p25: [
    "def mean_price_per_sqm(csv_path, gu_name):",
    "    return 0.0",
    "",
  ].join("\n"),
  zero: [
    "def mean_price_per_sqm(csv_path, gu_name):",
    "    return 1.0",
    "",
  ].join("\n"),
};

function wrongChoice(correctIndex, choiceCount) {
  return (correctIndex + 1) % choiceCount;
}

function buildAnswers(profile, ids) {
  const mcqCorrect = { q1: 0, q2: 1, q3: 1, q4: 2 };
  const mcqChoices = { q1: 4, q2: 4, q3: 4, q4: 4 };

  const selected = {};
  if (profile === "elite") {
    selected.q1 = mcqCorrect.q1;
    selected.q2 = mcqCorrect.q2;
    selected.q3 = mcqCorrect.q3;
    selected.q4 = mcqCorrect.q4;
  } else if (profile === "high") {
    selected.q1 = mcqCorrect.q1;
    selected.q2 = mcqCorrect.q2;
    selected.q3 = mcqCorrect.q3;
    selected.q4 = wrongChoice(mcqCorrect.q4, mcqChoices.q4);
  } else if (profile === "mid") {
    selected.q1 = mcqCorrect.q1;
    selected.q2 = wrongChoice(mcqCorrect.q2, mcqChoices.q2);
    selected.q3 = mcqCorrect.q3;
    selected.q4 = wrongChoice(mcqCorrect.q4, mcqChoices.q4);
  } else if (profile === "low") {
    selected.q1 = wrongChoice(mcqCorrect.q1, mcqChoices.q1);
    selected.q2 = mcqCorrect.q2;
    selected.q3 = wrongChoice(mcqCorrect.q3, mcqChoices.q3);
    selected.q4 = wrongChoice(mcqCorrect.q4, mcqChoices.q4);
  } else if (profile === "mixed") {
    selected.q1 = mcqCorrect.q1;
    selected.q2 = wrongChoice(mcqCorrect.q2, mcqChoices.q2);
    selected.q3 = wrongChoice(mcqCorrect.q3, mcqChoices.q3);
    selected.q4 = mcqCorrect.q4;
  } else {
    selected.q1 = wrongChoice(mcqCorrect.q1, mcqChoices.q1);
    selected.q2 = wrongChoice(mcqCorrect.q2, mcqChoices.q2);
    selected.q3 = wrongChoice(mcqCorrect.q3, mcqChoices.q3);
    selected.q4 = wrongChoice(mcqCorrect.q4, mcqChoices.q4);
  }

  let s5 = "모름";
  let s6 = "모름";
  let c7 = CODE_Q7.zero;
  let c8 = CODE_Q8.zero;

  if (profile === "elite") {
    s5 = "데이터누수방지";
    s6 = "귀무가설기각";
    c7 = CODE_Q7.perfect;
    c8 = CODE_Q8.perfect;
  } else if (profile === "high") {
    s5 = "데이터누수방지";
    s6 = "귀무가설채택";
    c7 = CODE_Q7.p75;
    c8 = CODE_Q8.perfect;
  } else if (profile === "mid") {
    s5 = "데이터누수방지";
    s6 = "기각아님";
    c7 = CODE_Q7.p50;
    c8 = CODE_Q8.p75;
  } else if (profile === "low") {
    s5 = "과적합방지";
    s6 = "채택";
    c7 = CODE_Q7.p50;
    c8 = CODE_Q8.p25;
  } else if (profile === "mixed") {
    s5 = "데이터누수방지";
    s6 = "귀무가설기각";
    c7 = CODE_Q7.perfect;
    c8 = CODE_Q8.p25;
  }

  return [
    { question_id: ids.q1, selected_choice_index: selected.q1 },
    { question_id: ids.q2, selected_choice_index: selected.q2 },
    { question_id: ids.q3, selected_choice_index: selected.q3 },
    { question_id: ids.q4, selected_choice_index: selected.q4 },
    { question_id: ids.q5, answer_text: s5 },
    { question_id: ids.q6, answer_text: s6 },
    { question_id: ids.q7, answer_text: c7 },
    { question_id: ids.q8, answer_text: c8 },
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

    if (answer.question_type === "subjective") {
      maxPoints += 1;
      const key = normalizeText(answer.answer_key_text);
      const user = normalizeText(answer.answer_text);
      if (key && key === user) {
        earned += 1;
      }
      continue;
    }

    if (answer.question_type === "coding") {
      maxPoints += 1;
      if (typeof answer.grading_score === "number" && typeof answer.grading_max_score === "number" && answer.grading_max_score > 0) {
        earned += answer.grading_score / answer.grading_max_score;
      }
    }
  }
  const percent = maxPoints > 0 ? Number(((earned / maxPoints) * 100).toFixed(2)) : 0;
  return { earned, maxPoints, percent };
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

async function main() {
  ensure(Number.isInteger(USERS) && USERS >= 30, "VIRTUAL_USERS must be an integer >= 30");

  const datasetZip = await assertFileExists(DATASET_ZIP_PATH);
  const assignmentPdf = await assertFileExists(ASSIGNMENT_PDF_PATH);
  const answerNotebook = await assertFileExists(ANSWER_NOTEBOOK_PATH);

  const suffix = Date.now();
  const fixtureDir = path.resolve("tmp", `assignment-exam-${suffix}`);
  await fs.mkdir(fixtureDir, { recursive: true });
  const testsZip = await createTestsArchive(fixtureDir);

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
  ensure(Array.isArray(exam.questions) && exam.questions.length === 8, "question count mismatch");

  const uploadResults = [];
  uploadResults.push(await uploadResource(exam.id, adminToken, datasetZip));
  uploadResults.push(await uploadResource(exam.id, adminToken, assignmentPdf));
  uploadResults.push(await uploadResource(exam.id, adminToken, answerNotebook));
  uploadResults.push(await uploadResource(exam.id, adminToken, testsZip));

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
  };
  ensure(Object.values(ids).every(Boolean), "failed to resolve question ids");

  const userPrefix = `assign_${String(suffix).slice(-8)}`;
  const users = Array.from({ length: USERS }, (_, idx) => ({
    username: `${userPrefix}_${String(idx + 1).padStart(2, "0")}`,
    name: `Assignment User ${idx + 1}`,
    track_name: TRACK_NAME,
    password: USER_PASSWORD,
  }));

  const registerStatuses = await Promise.all(users.map((user) => registerUser(user)));
  const loginTokens = await Promise.all(users.map((user) => login(user.username, user.password)));

  const examChecks = await Promise.all(
    loginTokens.map((token) =>
      api("GET", "/exams", {
        token,
        expected: [200],
      }),
    ),
  );
  for (const check of examChecks) {
    const idsInList = Array.isArray(check.data) ? check.data.map((row) => row.id) : [];
    ensure(idsInList.includes(exam.id), `exam is not visible to one of the virtual users: exam_id=${exam.id}`);
  }

  const profiles = ["elite", "high", "mid", "low", "mixed", "weak"];
  const submitResults = await Promise.allSettled(
    loginTokens.map((token, idx) =>
      api("POST", `/exams/${exam.id}/submit`, {
        token,
        json: {
          answers: buildAnswers(profiles[idx % profiles.length], ids),
        },
        expected: [200],
      }),
    ),
  );
  const submitSuccess = submitResults.filter((row) => row.status === "fulfilled").length;
  ensure(submitSuccess === USERS, `submission success mismatch: ${submitSuccess}/${USERS}`);

  const gradingCandidates = await api("GET", `/admin/grading/exam-submissions?exam_id=${exam.id}&coding_only=true&limit=500`, {
    token: adminToken,
    expected: [200],
  });
  const queueTargets = Array.isArray(gradingCandidates.data)
    ? gradingCandidates.data
        .filter((row) => !["QUEUED", "RUNNING", "GRADED", "FAILED"].includes(String(row.status)))
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

  const submissions = await waitForExamSubmissionsSettled(exam.id, adminToken, USERS, 600_000);
  ensure(submissions.length >= USERS, `admin submissions mismatch: ${submissions.length}/${USERS}`);

  const codingScoresQ7 = [];
  const codingScoresQ8 = [];
  const totalPercents = [];

  for (const submission of submissions) {
    const scored = scoreSubmission(submission);
    totalPercents.push(scored.percent);

    const q7 = submission.answers.find((answer) => answer.question_order === 7);
    const q8 = submission.answers.find((answer) => answer.question_order === 8);
    if (typeof q7?.grading_score === "number") codingScoresQ7.push(q7.grading_score);
    if (typeof q8?.grading_score === "number") codingScoresQ8.push(q8.grading_score);
  }

  ensure(codingScoresQ7.length === USERS, "coding q7 score count mismatch");
  ensure(codingScoresQ8.length === USERS, "coding q8 score count mismatch");
  ensure(new Set(codingScoresQ7).size >= 2, "q7 coding score diversity is too low");
  ensure(new Set(codingScoresQ8).size >= 2, "q8 coding score diversity is too low");
  ensure(new Set(totalPercents).size >= 5, "overall score diversity is too low");

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
    files: {
      datasetZip,
      assignmentPdf,
      answerNotebook,
      testsZip,
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
    scores: {
      overallPercent: {
        min: Math.min(...totalPercents),
        max: Math.max(...totalPercents),
        avg: Number((sum(totalPercents) / totalPercents.length).toFixed(2)),
        unique: Array.from(new Set(totalPercents)).sort((a, b) => a - b),
      },
      codingQ7: {
        min: Math.min(...codingScoresQ7),
        max: Math.max(...codingScoresQ7),
        avg: Number((sum(codingScoresQ7) / codingScoresQ7.length).toFixed(2)),
        unique: Array.from(new Set(codingScoresQ7)).sort((a, b) => a - b),
      },
      codingQ8: {
        min: Math.min(...codingScoresQ8),
        max: Math.max(...codingScoresQ8),
        avg: Number((sum(codingScoresQ8) / codingScoresQ8.length).toFixed(2)),
        unique: Array.from(new Set(codingScoresQ8)).sort((a, b) => a - b),
      },
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
  console.error("[assignment-exam-simulation] FAIL");
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
