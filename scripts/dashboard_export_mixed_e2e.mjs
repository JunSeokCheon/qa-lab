import fs from "node:fs/promises";
import path from "node:path";

const API_BASE = process.env.API_BASE_URL ?? "http://127.0.0.1:8000";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "admin1234";
const USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? "Passw0rd!123";
const RUN_ID = String(Date.now()).slice(-8);
const TRACK_NAME = process.env.TEST_TRACK_NAME ?? `E2E-TRACK-${RUN_ID}`;
const DISABLE_CUT = ["1", "true", "yes", "on", "y"].includes(
  String(process.env.TEST_DISABLE_CUT ?? "").toLowerCase()
);
const TEST_OBJECTIVE_FLIP = !["0", "false", "no", "off", "n"].includes(
  String(process.env.TEST_OBJECTIVE_FLIP ?? "1").toLowerCase()
);
const TEST_CLEANUP = !["0", "false", "no", "off", "n"].includes(
  String(process.env.TEST_CLEANUP ?? "1").toLowerCase()
);
const USERNAME_PREFIX = `mix_u_${RUN_ID}_`;
const CLEANUP_CONTEXT = {
  adminToken: null,
  examId: null,
  trackName: null,
  usernamePrefix: USERNAME_PREFIX,
  createdUserIds: [],
};

const GRADE_HIGH = "\uC0C1";
const GRADE_MID = "\uC911";
const GRADE_LOW = "\uD558";
const GRADE_UNSET = "\uBBF8\uC124\uC815";

const GRADE_ORDER = {
  [GRADE_HIGH]: 0,
  [GRADE_MID]: 1,
  [GRADE_LOW]: 2,
  [GRADE_UNSET]: 3,
};

const TARGET_CORRECT_COUNTS = [11, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 0];

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeIndexes(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => Number.isInteger(value)))].sort((a, b) => a - b);
}

function extractSelectedIndexes(answer) {
  if (Array.isArray(answer.selected_choice_indexes) && answer.selected_choice_indexes.length > 0) {
    return normalizeIndexes(answer.selected_choice_indexes);
  }
  if (Number.isInteger(answer.selected_choice_index)) {
    return [answer.selected_choice_index];
  }
  return [];
}

function extractCorrectIndexes(answer) {
  if (Array.isArray(answer.correct_choice_indexes) && answer.correct_choice_indexes.length > 0) {
    return normalizeIndexes(answer.correct_choice_indexes);
  }
  if (Number.isInteger(answer.correct_choice_index)) {
    return [answer.correct_choice_index];
  }
  return [];
}

function isSameIndexes(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function isFullyCorrect(answer) {
  const feedback = answer.grading_feedback_json;
  if (feedback && typeof feedback === "object" && feedback.source === "manual" && typeof feedback.is_correct === "boolean") {
    return feedback.is_correct;
  }

  if (answer.question_type === "multiple_choice") {
    const selected = extractSelectedIndexes(answer);
    const correct = extractCorrectIndexes(answer);
    return selected.length > 0 && isSameIndexes(selected, correct);
  }

  return (
    answer.grading_status === "GRADED" &&
    answer.grading_score !== null &&
    answer.grading_max_score !== null &&
    answer.grading_max_score > 0 &&
    answer.grading_score === answer.grading_max_score
  );
}

async function apiRequest(pathname, { method = "GET", token, body, expected = [200] } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  const rawText = await response.text();
  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = rawText;
    }
  }

  if (!expected.includes(response.status)) {
    throw new Error(`HTTP ${response.status} ${method} ${pathname}\n${JSON.stringify(payload)}`);
  }
  return payload;
}

async function login(username, password) {
  const payload = await apiRequest("/auth/login", {
    method: "POST",
    body: {
      username,
      password,
      remember_me: false,
    },
    expected: [200],
  });
  assertCondition(payload && payload.access_token, `로그인 실패: ${username}`);
  return payload.access_token;
}

async function ensureTrack(adminToken, trackName) {
  const tracks = await apiRequest("/admin/tracks", { token: adminToken, expected: [200] });
  assertCondition(Array.isArray(tracks), "트랙 조회 응답이 배열이 아닙니다.");
  if (tracks.includes(trackName)) return trackName;

  const created = await apiRequest("/admin/tracks", {
    method: "POST",
    token: adminToken,
    body: { name: trackName },
    expected: [201, 409],
  });
  if (created && typeof created.name === "string") return created.name;

  const refreshed = await apiRequest("/admin/tracks", { token: adminToken, expected: [200] });
  const found = refreshed.find((name) => name === trackName);
  assertCondition(Boolean(found), `트랙 생성/조회 실패: ${trackName}`);
  return trackName;
}

async function listUsersByKeyword(adminToken, keyword) {
  const payload = await apiRequest(
    `/admin/users?limit=500&keyword=${encodeURIComponent(keyword)}&role=all`,
    {
      token: adminToken,
      expected: [200],
    }
  );
  return Array.isArray(payload) ? payload : [];
}

async function cleanupTestData({
  adminToken,
  examId,
  trackName,
  usernamePrefix,
  createdUserIds,
}) {
  if (!adminToken) return;

  if (Number.isInteger(examId)) {
    try {
      await apiRequest(`/admin/exams/${examId}`, {
        method: "DELETE",
        token: adminToken,
        expected: [204, 404],
      });
      console.log(`[E2E][cleanup] exam deleted: ${examId}`);
    } catch (error) {
      console.warn(`[E2E][cleanup] exam delete failed: ${examId}`, error);
    }
  }

  const candidateUsers = [];
  const idSet = new Set();
  for (const userId of createdUserIds ?? []) {
    if (Number.isInteger(userId) && !idSet.has(userId)) {
      idSet.add(userId);
      candidateUsers.push({ id: userId });
    }
  }

  try {
    const listed = await listUsersByKeyword(adminToken, usernamePrefix);
    for (const user of listed) {
      if (!user || typeof user.username !== "string" || !Number.isInteger(user.id)) continue;
      if (!user.username.startsWith(usernamePrefix)) continue;
      if (idSet.has(user.id)) continue;
      idSet.add(user.id);
      candidateUsers.push(user);
    }
  } catch (error) {
    console.warn("[E2E][cleanup] user list by keyword failed", error);
  }

  for (const user of candidateUsers) {
    try {
      await apiRequest(`/admin/users/${user.id}`, {
        method: "DELETE",
        token: adminToken,
        expected: [204, 404],
      });
      console.log(`[E2E][cleanup] user deleted: ${user.id}`);
    } catch (error) {
      console.warn(`[E2E][cleanup] user delete failed: ${user.id}`, error);
    }
  }

  if (trackName && typeof trackName === "string") {
    try {
      await apiRequest(`/admin/tracks/${encodeURIComponent(trackName)}`, {
        method: "DELETE",
        token: adminToken,
        expected: [204, 404],
      });
      console.log(`[E2E][cleanup] track deleted: ${trackName}`);
    } catch (error) {
      console.warn(`[E2E][cleanup] track delete failed: ${trackName}`, error);
    }
  }
}


function buildExamQuestions() {
  return [
    {
      type: "multiple_choice",
      prompt_md: "1번 객관식: 파이썬에서 리스트 생성 문법은?",
      required: true,
      choices: ["[1,2,3]", "{1,2,3}", "(1,2,3)", "list(1,2,3)"],
      correct_choice_index: 0,
      correct_choice_indexes: [0],
      answer_key_text: null,
    },
    {
      type: "subjective",
      prompt_md: "2번 주관식: 평균(mean)과 중앙값(median)의 차이를 설명하라.",
      required: true,
      choices: null,
      correct_choice_index: null,
      correct_choice_indexes: null,
      answer_key_text: "이상치(outlier)에 대한 민감도 차이를 중심으로 설명하면 정답.",
    },
    {
      type: "coding",
      prompt_md: "3번 코딩: numbers 리스트 합계를 반환하는 함수 sum_numbers 작성.",
      required: true,
      choices: null,
      correct_choice_index: null,
      correct_choice_indexes: null,
      answer_key_text: "def sum_numbers(numbers): return sum(numbers)",
    },
    {
      type: "multiple_choice",
      prompt_md: "4번 객관식: pandas DataFrame에서 열 선택은?",
      required: true,
      choices: ["df['col']", "df(col)", "df.col()", "df->col"],
      correct_choice_index: 0,
      correct_choice_indexes: [0],
      answer_key_text: null,
    },
    {
      type: "multiple_choice",
      prompt_md: "5번 객관식: SQL에서 중복 제거 키워드는?",
      required: true,
      choices: ["DISTINCT", "UNIQUE", "REMOVE DUP", "FILTER"],
      correct_choice_index: 0,
      correct_choice_indexes: [0],
      answer_key_text: null,
    },
    {
      type: "subjective",
      prompt_md: "6번 주관식: 표준편차가 큰 데이터의 특징을 설명하라.",
      required: true,
      choices: null,
      correct_choice_index: null,
      correct_choice_indexes: null,
      answer_key_text: "평균으로부터 데이터가 넓게 퍼져 있음을 설명하면 정답.",
    },
    {
      type: "coding",
      prompt_md: "7번 코딩: 문자열 s를 뒤집어 반환하는 reverse_text 함수 작성.",
      required: true,
      choices: null,
      correct_choice_index: null,
      correct_choice_indexes: null,
      answer_key_text: "def reverse_text(s): return s[::-1]",
    },
    {
      type: "multiple_choice",
      prompt_md: "8번 객관식: matplotlib 그래프 표시 함수는?",
      required: true,
      choices: ["plt.show()", "plt.display()", "show.plot()", "display.plot()"],
      correct_choice_index: 0,
      correct_choice_indexes: [0],
      answer_key_text: null,
    },
    {
      type: "multiple_choice",
      prompt_md: "9번 객관식: 파이썬에서 딕셔너리 키 조회는?",
      required: true,
      choices: ["d['k']", "d('k')", "d.k()", "d->k"],
      correct_choice_index: 0,
      correct_choice_indexes: [0],
      answer_key_text: null,
    },
    {
      type: "subjective",
      prompt_md: "10번 주관식: 정규화(normalization)가 필요한 이유를 설명하라.",
      required: true,
      choices: null,
      correct_choice_index: null,
      correct_choice_indexes: null,
      answer_key_text: "스케일 차이로 인한 모델 편향 완화를 설명하면 정답.",
    },
    {
      type: "coding",
      prompt_md: "11번 코딩: 짝수만 남기는 filter_even 함수 작성.",
      required: true,
      choices: null,
      correct_choice_index: null,
      correct_choice_indexes: null,
      answer_key_text: "def filter_even(nums): return [n for n in nums if n % 2 == 0]",
    },
    {
      type: "multiple_choice",
      prompt_md: "12번 객관식: HTTP 성공 상태 코드는?",
      required: true,
      choices: ["200", "404", "500", "301"],
      correct_choice_index: 0,
      correct_choice_indexes: [0],
      answer_key_text: null,
    },
  ];
}

function buildSubmissionAnswers(questions, targetCorrectCount, userIndex) {
  return questions.map((question, idx) => {
    const order = idx + 1;
    const isCorrect = order <= targetCorrectCount;
    if (question.type === "multiple_choice") {
      const correctIndexes = normalizeIndexes(question.correct_choice_indexes);
      const firstCorrect = Number.isInteger(question.correct_choice_index)
        ? question.correct_choice_index
        : (correctIndexes[0] ?? 0);
      const wrongIndex = firstCorrect === 0 ? 1 : 0;
      return {
        question_id: question.id,
        selected_choice_index: isCorrect ? firstCorrect : wrongIndex,
        selected_choice_indexes: [isCorrect ? firstCorrect : wrongIndex],
        answer_text: null,
      };
    }

    return {
      question_id: question.id,
      answer_text: isCorrect
        ? `정답으로 처리될 답안 ${userIndex + 1}-${order}`
        : `오답으로 처리될 답안 ${userIndex + 1}-${order}`,
      selected_choice_index: null,
      selected_choice_indexes: null,
    };
  });
}

function toExportRows(submissions, questions, scoring, cuts) {
  const questionCount = questions.length;
  const totalWeightedMaxScore = questions.reduce((sum, question) => sum + question.score, 0);

  const studentRows = submissions.map((submission) => {
    const answerMap = new Map(submission.answers.map((answer) => [answer.question_id, answer]));
    const values = questions.map((question) => (isFullyCorrect(answerMap.get(question.id) ?? {}) ? 1 : 0));
    const correctCount = values.reduce((sum, value) => sum + value, 0);
    const correctRate = questionCount > 0 ? correctCount / questionCount : 0;
    const weightedScore = values.reduce((sum, value, index) => sum + value * (questions[index]?.score ?? 0), 0);
    const normalizedScore = totalWeightedMaxScore > 0 ? weightedScore / totalWeightedMaxScore : 0;

    const grade =
      cuts && Number.isInteger(cuts.high) && Number.isInteger(cuts.mid) && cuts.high > cuts.mid
        ? correctCount >= cuts.high
          ? GRADE_HIGH
          : correctCount >= cuts.mid
            ? GRADE_MID
            : GRADE_LOW
        : GRADE_UNSET;

    return {
      username: submission.username,
      userName: submission.user_name,
      values,
      correctCount,
      correctRate,
      weightedScore,
      normalizedScore,
      grade,
    };
  });

  studentRows.sort((left, right) => {
    const byGrade = GRADE_ORDER[left.grade] - GRADE_ORDER[right.grade];
    if (byGrade !== 0) return byGrade;
    if (left.normalizedScore !== right.normalizedScore) return right.normalizedScore - left.normalizedScore;
    return left.userName.localeCompare(right.userName, "ko");
  });

  const questionSums = new Array(questionCount).fill(0);
  for (const row of studentRows) {
    row.values.forEach((value, index) => {
      questionSums[index] += value;
    });
  }

  const questionRates = studentRows.length > 0 ? questionSums.map((sum) => sum / studentRows.length) : questionSums.map(() => 0);
  const avgCorrectCount =
    studentRows.length > 0 ? studentRows.reduce((sum, row) => sum + row.correctCount, 0) / studentRows.length : 0;
  const avgCorrectRate =
    studentRows.length > 0 ? studentRows.reduce((sum, row) => sum + row.correctRate, 0) / studentRows.length : 0;
  const avgWeightedScore =
    studentRows.length > 0 ? studentRows.reduce((sum, row) => sum + row.weightedScore, 0) / studentRows.length : 0;
  const avgNormalizedScore =
    studentRows.length > 0 ? studentRows.reduce((sum, row) => sum + row.normalizedScore, 0) / studentRows.length : 0;

  const rows = [];
  const totalColumns = questionCount + 6;
  const topRow = new Array(totalColumns).fill("");
  topRow[1] = "문항별 채점";
  topRow[questionCount + 3] = "최종성적";
  rows.push(topRow);
  rows.push([
    "수강생",
    ...questions.map((question) => `${question.order}번`),
    "합계",
    "정답률",
    "합산점수",
    "합산점수(100점 환산)",
    "등급",
  ]);
  rows.push([
    "",
    ...questions.map((question) => `${question.label}(${question.score}점)`),
    "",
    "",
    "",
    "",
    "",
  ]);
  rows.push([
    "전체 평균 점수(100점 환산)",
    ...new Array(questionCount).fill(""),
    Number(avgCorrectCount.toFixed(1)),
    `${Math.round(avgCorrectRate * 100)}%`,
    Number(avgWeightedScore.toFixed(1)),
    `${Math.round(avgNormalizedScore * 100)}%`,
    "",
  ]);
  rows.push(["합계", ...questionSums, "", "", "", "", ""]);
  rows.push(["정답률(%)", ...questionRates.map((ratio) => `${Math.round(ratio * 100)}%`), "", "", "", "", ""]);

  for (const row of studentRows) {
    rows.push([
      row.userName,
      ...row.values,
      row.correctCount,
      `${Math.round(row.correctRate * 100)}%`,
      row.weightedScore,
      `${Math.round(row.normalizedScore * 100)}%`,
      row.grade,
    ]);
  }

  return {
    studentRows,
    rows,
    totalWeightedMaxScore,
    scoring,
  };
}

async function main() {
  console.log(`[E2E] API BASE: ${API_BASE}`);
  const adminToken = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  CLEANUP_CONTEXT.adminToken = adminToken;
  console.log("[E2E] admin 로그인 완료");

  const trackName = await ensureTrack(adminToken, TRACK_NAME);
  CLEANUP_CONTEXT.trackName = trackName;
  console.log(`[E2E] 테스트 트랙 준비 완료: ${trackName}`);

  const examTitle = `E2E 배포검증 혼합문항 ${RUN_ID}`;
  const examCreatePayload = {
    title: examTitle,
    description: "대시보드 통합 내보내기 검증용(객관식/주관식/코딩 혼합)",
    folder_id: null,
    exam_kind: "assessment",
    target_track_name: trackName,
    status: "published",
    starts_at: null,
    duration_minutes: 60,
    multiple_choice_score: 1,
    subjective_score: 3,
    coding_score: 5,
    performance_high_min_correct: DISABLE_CUT ? null : 9,
    performance_mid_min_correct: DISABLE_CUT ? null : 5,
    questions: buildExamQuestions(),
  };

  const createdExam = await apiRequest("/admin/exams", {
    method: "POST",
    token: adminToken,
    body: examCreatePayload,
    expected: [201],
  });

  assertCondition(createdExam && createdExam.id, "시험 생성 응답에 id가 없습니다.");
  const examId = createdExam.id;
  CLEANUP_CONTEXT.examId = examId;
  const createdQuestions = [...(createdExam.questions ?? [])].sort((a, b) => a.order_index - b.order_index);
  assertCondition(createdQuestions.length >= 10, "생성된 문항 수가 10 미만입니다.");
  const questionTypes = new Set(createdQuestions.map((question) => question.type));
  assertCondition(
    questionTypes.has("multiple_choice") && questionTypes.has("subjective") && questionTypes.has("coding"),
    "문항 타입 3종(객관식/주관식/코딩)이 모두 포함되지 않았습니다."
  );
  console.log(`[E2E] 시험 생성 완료: exam_id=${examId}, question_count=${createdQuestions.length}`);

  const users = TARGET_CORRECT_COUNTS.map((target, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    return {
      username: `${USERNAME_PREFIX}${suffix}`,
      displayName: `가상학생-${RUN_ID}-${suffix}`,
      targetCorrect: target,
      index,
    };
  });

  for (const user of users) {
    const registerPayload = await apiRequest("/auth/register", {
      method: "POST",
      body: {
        username: user.username,
        name: user.displayName,
        track_name: trackName,
        password: USER_PASSWORD,
      },
      expected: [200, 201, 400, 409],
    });
    if (registerPayload && Number.isInteger(registerPayload.id)) {
      CLEANUP_CONTEXT.createdUserIds.push(registerPayload.id);
    }

    const userToken = await login(user.username, USER_PASSWORD);
    const answers = buildSubmissionAnswers(createdQuestions, user.targetCorrect, user.index);
    await apiRequest(`/exams/${examId}/submit`, {
      method: "POST",
      token: userToken,
      body: { answers },
      expected: [200],
    });
  }
  console.log(`[E2E] ${users.length}명 제출 완료`);

  const submissionsBefore = await apiRequest(`/admin/exams/${examId}/submissions`, {
    token: adminToken,
    expected: [200],
  });
  assertCondition(Array.isArray(submissionsBefore), "제출 목록 응답이 배열이 아닙니다.");
  assertCondition(submissionsBefore.length >= 20, `제출 수가 20 미만입니다. actual=${submissionsBefore.length}`);

  const targetByUsername = new Map(users.map((user) => [user.username, user.targetCorrect]));
  let manualGradeCount = 0;
  for (const submission of submissionsBefore) {
    const targetCorrect = targetByUsername.get(submission.username);
    assertCondition(Number.isInteger(targetCorrect), `제출자의 target 점수 매핑 누락: ${submission.username}`);
    for (const answer of submission.answers) {
      if (answer.question_type === "multiple_choice") continue;
      const shouldBeCorrect = answer.question_order <= targetCorrect;
      await apiRequest(
        `/admin/grading/exam-submissions/${submission.submission_id}/answers/${answer.question_id}/manual-grade`,
        {
          method: "POST",
          token: adminToken,
          body: {
            is_correct: shouldBeCorrect,
            note: "E2E mixed export test manual grading",
          },
          expected: [200],
        }
      );
      manualGradeCount += 1;
    }
  }
  console.log(`[E2E] 수동 채점 완료: ${manualGradeCount}건`);

  let submissionsAfter = await apiRequest(`/admin/exams/${examId}/submissions`, {
    token: adminToken,
    expected: [200],
  });
  assertCondition(Array.isArray(submissionsAfter), "재조회 제출 목록 응답이 배열이 아닙니다.");

  let objectiveFlip = null;
  if (TEST_OBJECTIVE_FLIP) {
    const targetUser = users[0];
    assertCondition(Boolean(targetUser), "객관식 정정 테스트 대상 사용자가 없습니다.");
    const targetSubmission = submissionsAfter.find((item) => item.username === targetUser.username);
    assertCondition(Boolean(targetSubmission), `객관식 정정 테스트 제출을 찾을 수 없습니다: ${targetUser.username}`);
    const firstObjectiveAnswer = (targetSubmission.answers ?? []).find((answer) => answer.question_type === "multiple_choice");
    assertCondition(Boolean(firstObjectiveAnswer), "객관식 정정 테스트용 객관식 답안이 없습니다.");

    await apiRequest(
      `/admin/grading/exam-submissions/${targetSubmission.submission_id}/answers/${firstObjectiveAnswer.question_id}/manual-grade`,
      {
        method: "POST",
        token: adminToken,
        body: {
          is_correct: false,
          note: "E2E objective flip test",
        },
        expected: [200],
      }
    );

    const flippedSubmissions = await apiRequest(`/admin/exams/${examId}/submissions`, {
      token: adminToken,
      expected: [200],
    });
    const flippedSubmission = flippedSubmissions.find((item) => item.username === targetUser.username);
    const flippedAnswer = (flippedSubmission?.answers ?? []).find(
      (answer) => answer.question_id === firstObjectiveAnswer.question_id
    );
    assertCondition(Boolean(flippedAnswer), "객관식 정정 후 답안을 다시 찾지 못했습니다.");
    assertCondition(isFullyCorrect(flippedAnswer) === false, "객관식 정정(정답->오답) 결과가 즉시 반영되지 않았습니다.");

    objectiveFlip = {
      username: targetUser.username,
      submissionId: targetSubmission.submission_id,
      questionId: firstObjectiveAnswer.question_id,
      questionOrder: firstObjectiveAnswer.question_order,
      changedToCorrect: false,
    };
    submissionsAfter = flippedSubmissions;
    console.log("[E2E] 객관식 정정(정답->오답) 즉시 반영 확인 완료");
  }

  assertCondition(createdExam.title === examTitle, "Korean exam title round-trip check failed.");
  assertCondition(
    submissionsAfter.some((item) => typeof item.user_name === "string" && item.user_name.includes(RUN_ID)),
    "Korean user display name round-trip check failed."
  );

  const serverCsv = await apiRequest(`/admin/exams/${examId}/results/csv`, {
    token: adminToken,
    expected: [200],
  });
  assertCondition(typeof serverCsv === "string" && serverCsv.length > 0, "Server CSV export payload is empty.");
  const serverCsvHasBom = serverCsv.charCodeAt(0) === 0xfeff;
  const serverCsvBody = serverCsvHasBom ? serverCsv.slice(1) : serverCsv;
  assertCondition(serverCsvBody.includes("\uC720\uC800 \uC544\uC774\uB514"), "Server CSV export Korean header check failed.");
  const scoring = {
    multipleChoice: createdExam.multiple_choice_score,
    subjective: createdExam.subjective_score,
    coding: createdExam.coding_score,
  };
  const exportQuestions = createdQuestions.map((question) => ({
    id: question.id,
    order: question.order_index,
    type: question.type,
    label: question.type === "multiple_choice" ? "객관식" : question.type === "subjective" ? "주관식" : "코딩",
    score:
      question.type === "multiple_choice"
        ? scoring.multipleChoice
        : question.type === "subjective"
          ? scoring.subjective
          : scoring.coding,
  }));

  const exportResult = toExportRows(submissionsAfter, exportQuestions, scoring, {
    high: createdExam.performance_high_min_correct,
    mid: createdExam.performance_mid_min_correct,
  });

  const gradeCounts = exportResult.studentRows.reduce(
    (acc, row) => {
      acc[row.grade] = (acc[row.grade] ?? 0) + 1;
      return acc;
    },
    { [GRADE_HIGH]: 0, [GRADE_MID]: 0, [GRADE_LOW]: 0, [GRADE_UNSET]: 0 }
  );

  if (DISABLE_CUT) {
    assertCondition(gradeCounts[GRADE_UNSET] === users.length, "? ??? ???? ?? ??? '???'??? ???.");
    assertCondition(
      gradeCounts[GRADE_HIGH] === 0 && gradeCounts[GRADE_MID] === 0 && gradeCounts[GRADE_LOW] === 0,
      "? ????? ?/?/?? ???????."
    );
  } else {
    assertCondition(
      gradeCounts[GRADE_HIGH] > 0 && gradeCounts[GRADE_MID] > 0 && gradeCounts[GRADE_LOW] > 0,
      "?/?/? ??? ?? ??? ?????."
    );
  }

  let isSorted = true;
  for (let index = 1; index < exportResult.studentRows.length; index += 1) {
    const prev = exportResult.studentRows[index - 1];
    const next = exportResult.studentRows[index];
    const prevRank = GRADE_ORDER[prev.grade];
    const nextRank = GRADE_ORDER[next.grade];
    if (prevRank > nextRank) {
      isSorted = false;
      break;
    }
    if (prevRank === nextRank && prev.normalizedScore < next.normalizedScore) {
      isSorted = false;
      break;
    }
    if (
      prevRank === nextRank &&
      prev.normalizedScore === next.normalizedScore &&
      prev.userName.localeCompare(next.userName, "ko") > 0
    ) {
      isSorted = false;
      break;
    }
  }
  assertCondition(isSorted, "정렬 조건(상->중->하->미설정, 환산점수 내림차순, 이름 오름차순)이 깨졌습니다.");

  const codingCount = exportQuestions.filter((question) => question.type === "coding").length;
  assertCondition(codingCount > 0, "코딩 문항 수가 0입니다.");
  assertCondition(scoring.coding !== scoring.subjective, "코딩 배점이 주관식과 동일하여 독립 검증이 불가능합니다.");
  const codingWeightAffectsResult = exportResult.studentRows.some((row) => {
    const plainSubjectiveWeighted = row.values.reduce((sum, value, index) => {
      const question = exportQuestions[index];
      if (!question) return sum;
      const weight =
        question.type === "multiple_choice"
          ? scoring.multipleChoice
          : question.type === "subjective"
            ? scoring.subjective
            : scoring.subjective;
      return sum + value * weight;
    }, 0);
    return plainSubjectiveWeighted !== row.weightedScore;
  });
  assertCondition(codingWeightAffectsResult, "코딩 배점 독립 반영 검증에 실패했습니다.");

  const csvPath = path.join(process.cwd(), "var", `dashboard-export-e2e-${RUN_ID}.csv`);
  await fs.mkdir(path.dirname(csvPath), { recursive: true });
  const csvContent = exportResult.rows
    .map((row) =>
      row
        .map((value) => {
          const text = value === null || value === undefined ? "" : String(value);
          return text.includes(",") || text.includes('"') || text.includes("\n")
            ? `"${text.replace(/"/g, '""')}"`
            : text;
        })
        .join(",")
    )
    .join("\r\n");
  await fs.writeFile(csvPath, `\uFEFF${csvContent}`, "utf8");

  const summary = {
    runId: RUN_ID,
    apiBase: API_BASE,
    disableCut: DISABLE_CUT,
    examId,
    examTitle,
    questionCount: exportQuestions.length,
    questionTypes: [...questionTypes],
    submissionCount: submissionsAfter.length,
    manualGradeCount,
    objectiveFlip,
    scoring,
    serverCsvHasBom,
    gradeCounts,
    sortedCheck: isSorted,
    csvPreviewPath: csvPath,
  };

  const summaryPath = path.join(process.cwd(), "var", `dashboard-export-e2e-${RUN_ID}.json`);
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`[E2E] 요약 저장: ${summaryPath}`);
  console.log(`[E2E] CSV 샘플 저장: ${csvPath}`);
  console.log("[E2E] 검증 통과");
  console.log(JSON.stringify(summary, null, 2));
}

async function runWithCleanup() {
  try {
    await main();
  } catch (error) {
    console.error("[E2E] failed", error);
    if (TEST_CLEANUP) {
      await cleanupTestData(CLEANUP_CONTEXT);
    }
    process.exit(1);
  }

  if (TEST_CLEANUP) {
    await cleanupTestData(CLEANUP_CONTEXT);
  }
}

void runWithCleanup();
