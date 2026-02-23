"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  target_track_name?: string | null;
  question_count: number;
};

type ExamSubmissionAnswer = {
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_md: string;
  choices: string[] | null;
  correct_choice_index: number | null;
  answer_key_text: string | null;
  answer_text: string | null;
  selected_choice_index: number | null;
  grading_status: string | null;
  grading_score: number | null;
  grading_max_score: number | null;
  grading_feedback_json: Record<string, unknown> | null;
  grading_logs: string | null;
  graded_at: string | null;
};

type ExamSubmission = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  user_id: number;
  user_name: string;
  username: string;
  status: string;
  submitted_at: string;
  answers: ExamSubmissionAnswer[];
};

type ChoiceStat = {
  questionId: number;
  questionOrder: number;
  prompt: string;
  choices: string[];
  correctChoiceIndex: number | null;
  counts: number[];
  respondents: string[][];
  unansweredUsers: string[];
  totalResponses: number;
};

type ManualGradeResponse = {
  message?: string;
  detail?: string;
};

type AppealRegradeResponse = {
  message?: string;
  detail?: string;
};

type AnswerVerdict = {
  label: string;
  className: string;
};

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
}

function manualGradeKey(submissionId: number, questionId: number): string {
  return `${submissionId}:${questionId}`;
}

function resolveAnswerVerdict(answer: ExamSubmissionAnswer): AnswerVerdict {
  if (answer.question_type === "multiple_choice") {
    if (answer.selected_choice_index === null || answer.correct_choice_index === null) {
      return { label: "미응답", className: "bg-muted text-muted-foreground" };
    }
    if (answer.selected_choice_index === answer.correct_choice_index) {
      return { label: "정답", className: "bg-emerald-100 text-emerald-800" };
    }
    return { label: "오답", className: "bg-rose-100 text-rose-800" };
  }

  if (answer.grading_status === "FAILED") {
    return { label: "채점 실패", className: "bg-rose-100 text-rose-800" };
  }
  if (answer.grading_status !== "GRADED") {
    return { label: "미채점", className: "bg-muted text-muted-foreground" };
  }
  if (answer.grading_score === null || answer.grading_max_score === null || answer.grading_max_score <= 0) {
    return { label: "채점 완료", className: "bg-amber-100 text-amber-800" };
  }
  if (answer.grading_score === answer.grading_max_score) {
    return { label: "정답", className: "bg-emerald-100 text-emerald-800" };
  }
  if (answer.grading_score === 0) {
    return { label: "오답", className: "bg-rose-100 text-rose-800" };
  }
  return { label: "부분 정답", className: "bg-amber-100 text-amber-800" };
}

type ExportCell = string | number | null | undefined;
type ExportRow = Record<string, ExportCell>;

function isFullyCorrect(answer: ExamSubmissionAnswer): boolean {
  if (answer.question_type === "multiple_choice") {
    return (
      answer.correct_choice_index !== null &&
      answer.selected_choice_index !== null &&
      answer.correct_choice_index === answer.selected_choice_index
    );
  }

  return (
    answer.grading_status === "GRADED" &&
    answer.grading_score !== null &&
    answer.grading_max_score !== null &&
    answer.grading_max_score > 0 &&
    answer.grading_score === answer.grading_max_score
  );
}

function toBinaryCorrect(answer: ExamSubmissionAnswer | undefined): number {
  if (!answer) return 0;
  return isFullyCorrect(answer) ? 1 : 0;
}

function summarizeNonObjectiveReason(answer: ExamSubmissionAnswer): string {
  if (answer.grading_status !== "GRADED" && answer.grading_status !== "FAILED") {
    return "아직 자동 채점이 시작되지 않았습니다. 관리자 승인 후 채점됩니다.";
  }

  if (isFullyCorrect(answer)) {
    return "정답입니다.";
  }

  const feedback = answer.grading_feedback_json as Record<string, unknown> | null;
  const rationale = feedback && typeof feedback.rationale === "object" ? (feedback.rationale as Record<string, unknown>) : null;
  if (rationale) {
    const summary = typeof rationale.summary === "string" ? rationale.summary.trim() : "";
    const missingPoints = Array.isArray(rationale.missing_points)
      ? rationale.missing_points.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0).slice(0, 3)
      : [];
    const deductions = Array.isArray(rationale.deductions)
      ? (rationale.deductions as Array<Record<string, unknown>>)
          .map((item) => {
            const reason = typeof item.reason === "string" ? item.reason.trim() : "";
            const points = typeof item.points === "number" ? item.points : null;
            if (!reason) return "";
            return points === null ? reason : `${reason} (-${points})`;
          })
          .filter((item) => item.length > 0)
          .slice(0, 3)
      : [];
    if (summary || missingPoints.length > 0 || deductions.length > 0) {
      const lines: string[] = [];
      if (summary) lines.push(summary);
      if (missingPoints.length > 0) lines.push(`누락 포인트: ${missingPoints.join(" / ")}`);
      if (deductions.length > 0) lines.push(`감점 근거: ${deductions.join(" / ")}`);
      return lines.join("\n");
    }
  }
  if (feedback && typeof feedback.reason === "string" && feedback.reason.trim()) {
    return feedback.reason.trim();
  }
  if (feedback && typeof feedback.note === "string" && feedback.note.trim()) {
    return `수동 채점 메모: ${feedback.note.trim()}`;
  }
  if (feedback && typeof feedback.error === "string" && feedback.error.trim()) {
    return feedback.error.trim().replace(/\s+/g, " ").slice(0, 260);
  }
  const issues =
    feedback && Array.isArray(feedback.issues)
      ? feedback.issues
          .map((item) => String(item ?? "").trim())
          .filter((item) => item.length > 0)
          .slice(0, 3)
      : [];
  if (issues.length > 0) {
    return issues.join(" / ");
  }
  const publicPart =
    feedback && typeof feedback.public === "object" ? (feedback.public as Record<string, unknown>) : null;
  const failedCases = Array.isArray(publicPart?.failed_cases)
    ? (publicPart?.failed_cases as Array<Record<string, unknown>>)
    : [];
  if (failedCases.length > 0) {
    const first = failedCases[0];
    const name = typeof first?.name === "string" ? first.name : "실패 테스트";
    const message = typeof first?.message === "string" ? first.message.replace(/\s+/g, " ").trim() : "";
    if (message) {
      return `${name}: ${message.slice(0, 260)}`;
    }
    return `${name} 테스트 실패`;
  }

  const hiddenPart =
    feedback && typeof feedback.hidden === "object" ? (feedback.hidden as Record<string, unknown>) : null;
  const hiddenFailedCount =
    hiddenPart && typeof hiddenPart.failed_count === "number" ? hiddenPart.failed_count : null;
  if (hiddenFailedCount && hiddenFailedCount > 0) {
    return `히든 테스트 ${hiddenFailedCount}건이 실패했습니다.`;
  }

  if (answer.grading_logs && answer.grading_logs.trim()) {
    const firstMeaningfulLine =
      answer.grading_logs
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && line !== "[stdout]" && line !== "[stderr]") ?? "";
    if (firstMeaningfulLine) {
      return firstMeaningfulLine.slice(0, 260);
    }
  }

  return "채점 로그에서 명확한 실패 사유를 찾지 못했습니다. 원본 로그를 확인해 주세요.";
}

function gradingEngineSummary(answer: ExamSubmissionAnswer): string | null {
  const feedback = answer.grading_feedback_json as Record<string, unknown> | null;
  if (!feedback) return null;
  const model = typeof feedback.model === "string" ? feedback.model : null;
  const promptVersion = typeof feedback.prompt_version === "string" ? feedback.prompt_version : null;
  const schemaVersion = typeof feedback.schema_version === "string" ? feedback.schema_version : null;
  const pieces = [model, promptVersion, schemaVersion].filter((value) => Boolean(value));
  if (pieces.length === 0) return null;
  return pieces.join(" | ");
}

function renderAnswerBlock(
  title: string,
  content: string | null | undefined,
  emptyText: string,
  className = "text-[11px]"
) {
  return (
    <div>
      <p className="text-muted-foreground">{title}</p>
      <pre className={`mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 ${className}`}>
        {content?.trim() ? content : emptyText}
      </pre>
    </div>
  );
}

function formatPercent(value: number): string {
  return value.toFixed(1);
}

function csvCell(value: ExportCell): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(headers: string[], rows: ExportRow[]): string {
  const lines: string[] = [headers.map((header) => csvCell(header)).join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function htmlCell(value: ExportCell): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildExcelHtml(headers: string[], rows: ExportRow[]): string {
  const headerHtml = headers.map((header) => `<th>${htmlCell(header)}</th>`).join("");
  const rowsHtml = rows
    .map((row) => {
      const cols = headers.map((header) => `<td>${htmlCell(row[header])}</td>`).join("");
      return `<tr>${cols}</tr>`;
    })
    .join("");

  return `
<html>
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
    <table border="1">
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </body>
</html>`;
}

function downloadText(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function AdminExamDashboard({ initialExams }: { initialExams: ExamSummary[] }) {
  const [exams] = useState(initialExams);
  const [examId, setExamId] = useState<number | null>(initialExams[0]?.id ?? null);
  const [submissions, setSubmissions] = useState<ExamSubmission[]>([]);
  const [questionFilter, setQuestionFilter] = useState<string>("all");
  const [studentFilter, setStudentFilter] = useState<string>("all");
  const [studentSearchKeyword, setStudentSearchKeyword] = useState("");
  const [manualScoreByKey, setManualScoreByKey] = useState<Record<string, string>>({});
  const [manualNoteByKey, setManualNoteByKey] = useState<Record<string, string>>({});
  const [manualRunningKeys, setManualRunningKeys] = useState<Set<string>>(new Set());
  const [appealReasonByKey, setAppealReasonByKey] = useState<Record<string, string>>({});
  const [appealRunningKeys, setAppealRunningKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const selectedExam = useMemo(() => exams.find((item) => item.id === examId) ?? null, [examId, exams]);

  const loadSubmissions = useCallback(async (targetExamId: number) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/exams/${targetExamId}/submissions`, { cache: "no-store" });
      const payload = (await response.json().catch(() => [])) as
        | ExamSubmission[]
        | { detail?: string; message?: string };
      if (!response.ok) {
        const messagePayload = payload as { detail?: string; message?: string };
        setError(messagePayload.detail ?? messagePayload.message ?? "시험 제출 목록을 불러오지 못했습니다.");
        setSubmissions([]);
        return false;
      }

      const rows = payload as ExamSubmission[];
      setSubmissions(rows);
      setManualScoreByKey(() => {
        const seeded: Record<string, string> = {};
        for (const submission of rows) {
          for (const answer of submission.answers) {
            if (answer.question_type === "multiple_choice") continue;
            seeded[manualGradeKey(submission.submission_id, answer.question_id)] =
              answer.grading_score === null ? "100" : String(answer.grading_score);
          }
        }
        return seeded;
      });
      setManualNoteByKey((prev) => {
        const next: Record<string, string> = {};
        for (const submission of rows) {
          for (const answer of submission.answers) {
            if (answer.question_type === "multiple_choice") continue;
            const key = manualGradeKey(submission.submission_id, answer.question_id);
            next[key] = prev[key] ?? "";
          }
        }
        return next;
      });
      setAppealReasonByKey((prev) => {
        const next: Record<string, string> = {};
        for (const submission of rows) {
          for (const answer of submission.answers) {
            if (answer.question_type === "multiple_choice") continue;
            const key = manualGradeKey(submission.submission_id, answer.question_id);
            next[key] = prev[key] ?? "";
          }
        }
        return next;
      });
      return true;
    } catch {
      setError("시험 제출 목록을 불러오지 못했습니다.");
      setSubmissions([]);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (examId === null) return;
    void loadSubmissions(examId);
  }, [examId, loadSubmissions]);

  const questionStats = useMemo(() => {
    const byQuestion = new Map<number, ChoiceStat>();
    for (const row of submissions) {
      for (const answer of row.answers) {
        if (answer.question_type !== "multiple_choice") continue;
        const existing = byQuestion.get(answer.question_id);
        if (!existing) {
          const choices = [...(answer.choices ?? [])];
          byQuestion.set(answer.question_id, {
            questionId: answer.question_id,
            questionOrder: answer.question_order,
            prompt: answer.prompt_md,
            choices,
            correctChoiceIndex: answer.correct_choice_index,
            counts: choices.map(() => 0),
            respondents: choices.map(() => [] as string[]),
            unansweredUsers: [],
            totalResponses: 0,
          });
        }

        const stat = byQuestion.get(answer.question_id);
        if (!stat) continue;
        const selected = answer.selected_choice_index;
        const userName = row.user_name;
        if (selected === null || selected < 0 || selected >= stat.choices.length) {
          stat.unansweredUsers.push(userName);
          continue;
        }
        stat.counts[selected] += 1;
        stat.respondents[selected].push(userName);
        stat.totalResponses += 1;
      }
    }
    return [...byQuestion.values()].sort((a, b) => a.questionOrder - b.questionOrder);
  }, [submissions]);

  const questionOptions = useMemo(
    () =>
      questionStats.map((item) => ({
        value: String(item.questionId),
        label: `${item.questionOrder}번 문항`,
      })),
    [questionStats]
  );

  const studentOptions = useMemo(() => {
    const names = new Set(submissions.map((row) => row.user_name));
    return [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }, [submissions]);

  const filteredStudentOptions = useMemo(() => {
    const keyword = studentSearchKeyword.trim().toLocaleLowerCase("ko");
    if (!keyword) return studentOptions;
    return studentOptions.filter((name) => name.toLocaleLowerCase("ko").includes(keyword));
  }, [studentOptions, studentSearchKeyword]);

  const filteredQuestionStats = useMemo(() => {
    if (questionFilter === "all") return questionStats;
    const questionId = Number(questionFilter);
    return questionStats.filter((item) => item.questionId === questionId);
  }, [questionFilter, questionStats]);

  const filteredSubmissions = useMemo(() => {
    const keyword = studentSearchKeyword.trim().toLocaleLowerCase("ko");
    return submissions.filter((row) => {
      if (studentFilter !== "all" && row.user_name !== studentFilter) return false;
      if (!keyword) return true;
      return (
        row.user_name.toLocaleLowerCase("ko").includes(keyword) ||
        row.username.toLocaleLowerCase("ko").includes(keyword)
      );
    });
  }, [studentFilter, studentSearchKeyword, submissions]);

  const totalQuestionCount = useMemo(() => {
    if (selectedExam?.question_count && selectedExam.question_count > 0) {
      return selectedExam.question_count;
    }
    if (submissions.length === 0) return 0;
    return Math.max(...submissions.map((row) => row.answers.length), 0);
  }, [selectedExam, submissions]);

  const correctCountDistribution = useMemo(() => {
    const buckets = new Map<number, { count: number; users: string[] }>();

    for (const row of filteredSubmissions) {
      const correct = row.answers.reduce((sum, answer) => sum + (isFullyCorrect(answer) ? 1 : 0), 0);

      const current = buckets.get(correct);
      if (!current) {
        buckets.set(correct, { count: 1, users: [row.user_name] });
      } else {
        current.count += 1;
        current.users.push(row.user_name);
      }
    }

    return [...buckets.entries()]
      .map(([correctCount, value]) => ({
        correctCount,
        count: value.count,
        users: value.users,
      }))
      .sort((a, b) => a.correctCount - b.correctCount);
  }, [filteredSubmissions]);

  const maxDistributionCount = useMemo(
    () => Math.max(1, ...correctCountDistribution.map((bucket) => bucket.count)),
    [correctCountDistribution]
  );

  const exportQuestions = useMemo(() => {
    const byQuestion = new Map<number, { id: number; order: number; type: string }>();
    for (const submission of submissions) {
      for (const answer of submission.answers) {
        if (answer.question_type !== "multiple_choice" && answer.question_type !== "coding") continue;
        if (!byQuestion.has(answer.question_id)) {
          byQuestion.set(answer.question_id, {
            id: answer.question_id,
            order: answer.question_order,
            type: answer.question_type,
          });
        }
      }
    }
    return [...byQuestion.values()].sort((a, b) => a.order - b.order);
  }, [submissions]);

  const exportQuestionHeaders = useMemo(
    () => exportQuestions.map((question) => `${question.order}번`),
    [exportQuestions]
  );

  const exportHeaders = useMemo(() => {
    return ["수강생", ...exportQuestionHeaders, "합계", "정답률(%)"];
  }, [exportQuestionHeaders]);

  const studentScoreRows = useMemo(() => {
    const questionCount = exportQuestions.length;
    return submissions.map((submission) => {
      const answerMap = new Map<number, ExamSubmissionAnswer>(
        submission.answers.map((answer) => [answer.question_id, answer])
      );
      const values = exportQuestions.map((question) => toBinaryCorrect(answerMap.get(question.id)));
      const total = values.reduce((sum, value) => sum + value, 0);
      const rate = questionCount > 0 ? (total / questionCount) * 100 : 0;
      return {
        userName: submission.user_name,
        values,
        total,
        rate,
      };
    });
  }, [exportQuestions, submissions]);

  const questionSums = useMemo(() => {
    const sums = new Array(exportQuestions.length).fill(0);
    for (const row of studentScoreRows) {
      row.values.forEach((value, index) => {
        sums[index] += value;
      });
    }
    return sums;
  }, [exportQuestions.length, studentScoreRows]);

  const questionRates = useMemo(() => {
    if (studentScoreRows.length === 0) return questionSums.map(() => 0);
    return questionSums.map((sum) => (sum / studentScoreRows.length) * 100);
  }, [questionSums, studentScoreRows.length]);

  const overallAverageScore = useMemo(() => {
    if (studentScoreRows.length === 0) return 0;
    const totalRate = studentScoreRows.reduce((sum, row) => sum + row.rate, 0);
    return totalRate / studentScoreRows.length;
  }, [studentScoreRows]);

  const exportRows = useMemo(() => {
    const rows: ExportRow[] = studentScoreRows.map((student) => {
      const row: ExportRow = {
        수강생: student.userName,
      };
      exportQuestionHeaders.forEach((header, index) => {
        row[header] = student.values[index];
      });
      row["합계"] = student.total;
      row["정답률(%)"] = formatPercent(student.rate);
      return row;
    });

    const sumRow: ExportRow = { 수강생: "합계" };
    exportQuestionHeaders.forEach((header, index) => {
      sumRow[header] = questionSums[index];
    });
    sumRow["합계"] = studentScoreRows.reduce((sum, student) => sum + student.total, 0);
    sumRow["정답률(%)"] = "";

    const rateRow: ExportRow = { 수강생: "정답률(%)" };
    exportQuestionHeaders.forEach((header, index) => {
      rateRow[header] = formatPercent(questionRates[index]);
    });
    rateRow["합계"] = formatPercent(overallAverageScore);
    rateRow["정답률(%)"] = formatPercent(overallAverageScore);

    const averageRow: ExportRow = { 수강생: "전체 평균 점수(100점)" };
    exportQuestionHeaders.forEach((header) => {
      averageRow[header] = "";
    });
    averageRow["합계"] = formatPercent(overallAverageScore);
    averageRow["정답률(%)"] = formatPercent(overallAverageScore);

    rows.push(sumRow, rateRow, averageRow);
    return rows;
  }, [exportQuestionHeaders, overallAverageScore, questionRates, questionSums, studentScoreRows]);

  const onDownloadCsv = () => {
    if (!selectedExam || exportRows.length === 0) return;
    const fileTitle = selectedExam.title
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "_")
      .slice(0, 40);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const csv = buildCsv(exportHeaders, exportRows);
    downloadText(csv, `${fileTitle || `exam-${selectedExam.id}`}_응시결과_${timestamp}.csv`, "text/csv;charset=utf-8;");
  };

  const onDownloadExcel = () => {
    if (!selectedExam || exportRows.length === 0) return;
    const fileTitle = selectedExam.title
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, "_")
      .slice(0, 40);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const html = buildExcelHtml(exportHeaders, exportRows);
    downloadText(
      html,
      `${fileTitle || `exam-${selectedExam.id}`}_응시결과_${timestamp}.xls`,
      "application/vnd.ms-excel;charset=utf-8;"
    );
  };

  const submitManualGrade = async (
    submissionId: number,
    questionId: number,
    score: number,
    note: string | null,
    options?: { overrideFieldValue?: string }
  ) => {
    if (examId === null) return;

    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setActionError("점수는 0~100 범위에서 입력해 주세요.");
      setActionMessage("");
      return;
    }

    const key = manualGradeKey(submissionId, questionId);
    const normalizedScore = Math.round(score);
    const normalizedNote = note?.trim() ? note.trim() : null;
    if (options?.overrideFieldValue !== undefined) {
      setManualScoreByKey((prev) => ({
        ...prev,
        [key]: options.overrideFieldValue ?? prev[key] ?? "",
      }));
    }

    setActionError("");
    setActionMessage("");
    setManualRunningKeys((prev) => new Set(prev).add(key));

    try {
      const response = await fetch(
        `/api/admin/grading/exam-submissions/${submissionId}/answers/${questionId}/manual-grade`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            score: normalizedScore,
            note: normalizedNote,
          }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as ManualGradeResponse;
      if (!response.ok) {
        setActionError(payload.detail ?? payload.message ?? "수동 채점 반영에 실패했습니다.");
        return;
      }

      setActionMessage(payload.message ?? "수동 채점을 반영했습니다.");
      await loadSubmissions(examId);
    } catch {
      setActionError("수동 채점 반영 요청에 실패했습니다.");
      setActionMessage("");
    } finally {
      setManualRunningKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const submitAppealRegrade = async (submissionId: number, questionId: number, reason: string | null) => {
    if (examId === null) return;

    const key = manualGradeKey(submissionId, questionId);
    const normalizedReason = reason?.trim() || null;

    setActionError("");
    setActionMessage("");
    setAppealRunningKeys((prev) => new Set(prev).add(key));

    try {
      const response = await fetch(`/api/admin/grading/exam-submissions/${submissionId}/appeal-regrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question_id: questionId,
          reason: normalizedReason,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as AppealRegradeResponse;
      if (!response.ok) {
        setActionError(payload.detail ?? payload.message ?? "재채점 요청에 실패했습니다.");
        return;
      }

      setActionMessage(payload.message ?? "이의제기 재채점 요청을 등록했습니다.");
      await loadSubmissions(examId);
    } catch {
      setActionError("재채점 요청에 실패했습니다.");
      setActionMessage("");
    } finally {
      setAppealRunningKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/" tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험 대시보드</h1>
        <p className="mt-2 text-sm text-hero-foreground/90">
          시험별 제출 현황, 객관식 통계, 학생별 상세 답안을 확인합니다.
        </p>
      </section>

      {actionError ? <p className="qa-card text-sm text-destructive">{actionError}</p> : null}
      {actionMessage ? <p className="qa-card text-sm text-emerald-700">{actionMessage}</p> : null}

      {exams.length === 0 ? (
        <section className="qa-card">
          <p className="text-sm text-muted-foreground">등록된 시험이 없습니다.</p>
        </section>
      ) : (
        <section className="qa-card space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <select
              className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
              value={examId ?? ""}
              onChange={(event) => {
                const nextId = Number(event.target.value);
                setExamId(Number.isFinite(nextId) ? nextId : null);
                setQuestionFilter("all");
                setStudentFilter("all");
                setStudentSearchKeyword("");
              }}
            >
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  #{exam.id} {exam.title} ({examKindLabel(exam.exam_kind)} / {exam.target_track_name ?? "미지정"})
                </option>
              ))}
            </select>

            <select
              className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
              value={questionFilter}
              onChange={(event) => setQuestionFilter(event.target.value)}
            >
              <option value="all">전체 객관식 문항</option>
              {questionOptions.map((question) => (
                <option key={question.value} value={question.value}>
                  {question.label}
                </option>
              ))}
            </select>

            <select
              className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
              value={studentFilter}
              onChange={(event) => setStudentFilter(event.target.value)}
            >
              <option value="all">전체 학생</option>
              {filteredStudentOptions.map((userName) => (
                <option key={userName} value={userName}>
                  {userName}
                </option>
              ))}
            </select>

            <Input
              className="h-11"
              placeholder="학생 이름/아이디 검색"
              value={studentSearchKeyword}
              onChange={(event) => setStudentSearchKeyword(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onDownloadCsv} disabled={loading || exportRows.length === 0}>
              CSV 다운로드
            </Button>
            <Button type="button" variant="outline" onClick={onDownloadExcel} disabled={loading || exportRows.length === 0}>
              엑셀(.xls) 다운로드
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            응시자 수: {submissions.length}명
            {studentFilter !== "all" || studentSearchKeyword.trim().length > 0
              ? ` | 필터 적용: ${filteredSubmissions.length}명`
              : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            다운로드 파일은 수강생 X 문항 1/0 매트릭스와 하단 합계/정답률/전체 평균 점수를 제공합니다.
          </p>
          {loading ? <p className="text-sm text-muted-foreground">불러오는 중...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </section>
      )}

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">맞힌 개수별 인원 수</h2>
        <p className="text-xs text-muted-foreground">
          전체 문항(객관식/주관식/코딩) 기준입니다. 막대에 마우스를 올리면 인원 수를 볼 수 있고, 우측에도 인원 수를 표시합니다.
        </p>
        {correctCountDistribution.length === 0 ? (
          <p className="text-sm text-muted-foreground">집계할 제출 데이터가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {correctCountDistribution.map((bucket) => {
              const width = (bucket.count / maxDistributionCount) * 100;
              return (
                <div key={bucket.correctCount} className="grid grid-cols-[120px_1fr_52px] items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    {bucket.correctCount}/{totalQuestionCount} 정답
                  </p>
                  <div className="group relative h-8 rounded-lg bg-surface-muted px-1 py-1">
                    <div className="pointer-events-none absolute -top-10 left-1/2 z-10 -translate-x-1/2 rounded-full border border-primary/20 bg-white/95 px-3 py-1 text-[11px] font-semibold text-primary shadow-sm opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                      {bucket.correctCount}개 정답: {bucket.count}명
                    </div>
                    <div
                      className="h-full rounded-md bg-gradient-to-r from-primary to-primary/80"
                      style={{ width: `${Math.max(4, width)}%` }}
                      aria-label={`${bucket.correctCount}/${totalQuestionCount} 정답 인원 ${bucket.count}명`}
                    />
                  </div>
                  <p className="text-right text-sm font-semibold text-foreground">{bucket.count}명</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">객관식 문항 통계</h2>
        {filteredQuestionStats.length === 0 ? (
          <p className="text-sm text-muted-foreground">객관식 응답 데이터가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {filteredQuestionStats.map((stat) => (
              <article key={stat.questionId} className="rounded-xl border border-border/70 bg-surface p-3">
                <p className="text-sm font-semibold">
                  {stat.questionOrder}. {stat.prompt}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">총 응답 수: {stat.totalResponses}</p>
                <div className="mt-2 space-y-3">
                  {stat.choices.map((choice, index) => {
                    const count = stat.counts[index];
                    const ratio = stat.totalResponses === 0 ? 0 : (count / stat.totalResponses) * 100;
                    return (
                      <div key={`${stat.questionId}-${index}`} className="rounded-lg bg-surface-muted p-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <p>
                            {index + 1}번 {choice}
                            {stat.correctChoiceIndex === index ? " (정답)" : ""}
                          </p>
                          <p className="text-muted-foreground">
                            {count}명 ({ratio.toFixed(1)}%)
                          </p>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-background/70">
                          <div className="h-2 rounded-full bg-primary" style={{ width: `${ratio}%` }} />
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          응답자: {stat.respondents[index].length ? stat.respondents[index].join(", ") : "-"}
                        </p>
                      </div>
                    );
                  })}
                  {stat.unansweredUsers.length > 0 ? (
                    <p className="rounded-lg bg-surface-muted p-2 text-xs text-muted-foreground">
                      미응답: {stat.unansweredUsers.join(", ")}
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">학생별 제출 상세</h2>
        {filteredSubmissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">조건에 맞는 제출이 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {filteredSubmissions.map((submission) => (
              <article key={submission.submission_id} className="rounded-xl border border-border/70 bg-surface p-3">
                <p className="text-sm font-semibold">
                  {submission.user_name} ({new Date(submission.submitted_at).toLocaleString()})
                </p>
                <div className="mt-2 space-y-2">
                  {submission.answers
                    .filter((answer) => (questionFilter === "all" ? true : answer.question_id === Number(questionFilter)))
                    .map((answer) => {
                      const key = manualGradeKey(submission.submission_id, answer.question_id);
                      const verdict = resolveAnswerVerdict(answer);
                      const isManualTarget = answer.question_type !== "multiple_choice";
                      const isManualRunning = manualRunningKeys.has(key);
                      const isAppealRunning = appealRunningKeys.has(key);
                      const scoreInput =
                        manualScoreByKey[key] ?? (answer.grading_score === null ? "100" : String(answer.grading_score));
                      const gradingEngine = gradingEngineSummary(answer);

                      return (
                        <div key={key} className="rounded-lg bg-surface-muted p-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">
                              {answer.question_order}. {answer.prompt_md}
                            </p>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${verdict.className}`}>
                              {verdict.label}
                            </span>
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            문항 유형:{" "}
                            {answer.question_type === "multiple_choice"
                              ? "객관식"
                              : answer.question_type === "coding"
                                ? "코딩"
                                : "주관식"}
                          </p>
                          {answer.question_type === "multiple_choice" ? (
                            <p className="mt-1 text-muted-foreground">
                              제출 답: {answer.selected_choice_index === null ? "-" : `${answer.selected_choice_index + 1}번`}
                            </p>
                          ) : null}
                          {answer.question_type === "multiple_choice" && answer.correct_choice_index !== null ? (
                            <p className="mt-1 text-muted-foreground">정답: {answer.correct_choice_index + 1}번</p>
                          ) : null}
                          {answer.question_type !== "multiple_choice" ? (
                            <p className="mt-1 text-muted-foreground">
                              채점 상태: {answer.grading_status ?? "미채점"}
                              {answer.grading_score !== null && answer.grading_max_score !== null
                                ? ` (${answer.grading_score}/${answer.grading_max_score})`
                                : ""}
                            </p>
                          ) : null}
                          {answer.question_type !== "multiple_choice" && gradingEngine ? (
                            <p className="mt-1 text-[11px] text-muted-foreground">채점 엔진: {gradingEngine}</p>
                          ) : null}
                          {answer.graded_at ? (
                            <p className="mt-1 text-muted-foreground">
                              채점 시각: {new Date(answer.graded_at).toLocaleString()}
                            </p>
                          ) : null}
                          {answer.question_type !== "multiple_choice" ? (
                            <div className="mt-2 rounded-md border border-border/70 bg-background/70 p-2">
                              <p className="font-medium">
                                {answer.question_type === "coding" ? "코딩 채점 상세" : "주관식 채점 상세"}
                              </p>
                              <div className="mt-2 space-y-2">
                                {renderAnswerBlock(
                                  "학생이 제출한 답안",
                                  answer.answer_text,
                                  "(미제출)",
                                  answer.question_type === "coding" ? "text-[11px]" : "text-xs"
                                )}
                                {renderAnswerBlock(
                                  "실제 정답/채점 기준",
                                  answer.answer_key_text,
                                  "(미입력: 수동 채점 필요)",
                                  answer.question_type === "coding" ? "text-[11px]" : "text-xs"
                                )}
                              </div>

                              <p className="mt-2 text-muted-foreground">
                                {isFullyCorrect(answer) ? "채점 사유" : "틀린 이유"}
                              </p>
                              <p className="mt-1 whitespace-pre-wrap rounded bg-surface-muted p-2 text-[11px]">
                                {summarizeNonObjectiveReason(answer)}
                              </p>

                              {answer.grading_logs ? (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-muted-foreground">원본 채점 로그 보기</summary>
                                  <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 text-[11px]">
                                    {answer.grading_logs}
                                  </pre>
                                </details>
                              ) : null}
                            </div>
                          ) : null}

                          {isManualTarget ? (
                            <div className="mt-2 rounded-md border border-border/70 bg-background/70 p-2">
                              <p className="font-medium">수동 채점</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={1}
                                  className="h-8 w-24"
                                  value={scoreInput}
                                  onChange={(event) =>
                                    setManualScoreByKey((prev) => ({
                                      ...prev,
                                      [key]: event.target.value,
                                    }))
                                  }
                                  disabled={isManualRunning}
                                />
                                <Button
                                  type="button"
                                  className="h-8 px-2 text-xs"
                                  onClick={() => {
                                    const parsed = Number(scoreInput);
                                    if (!Number.isFinite(parsed)) {
                                      setActionError("점수는 숫자로 입력해 주세요.");
                                      setActionMessage("");
                                      return;
                                    }
                                    void submitManualGrade(
                                      submission.submission_id,
                                      answer.question_id,
                                      parsed,
                                      manualNoteByKey[key] ?? null
                                    );
                                  }}
                                  disabled={isManualRunning}
                                >
                                  {isManualRunning ? "저장 중..." : "점수 저장"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  onClick={() =>
                                    void submitManualGrade(
                                      submission.submission_id,
                                      answer.question_id,
                                      100,
                                      manualNoteByKey[key] ?? null,
                                      { overrideFieldValue: "100" }
                                    )
                                  }
                                  disabled={isManualRunning}
                                >
                                  정답 처리(100)
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  onClick={() =>
                                    void submitManualGrade(
                                      submission.submission_id,
                                      answer.question_id,
                                      0,
                                      manualNoteByKey[key] ?? null,
                                      { overrideFieldValue: "0" }
                                    )
                                  }
                                  disabled={isManualRunning}
                                >
                                  오답 처리(0)
                                </Button>
                              </div>
                              <Textarea
                                className="mt-2 min-h-16"
                                placeholder="수동 채점 메모(선택)"
                                value={manualNoteByKey[key] ?? ""}
                                onChange={(event) =>
                                  setManualNoteByKey((prev) => ({
                                    ...prev,
                                    [key]: event.target.value,
                                  }))
                                }
                                disabled={isManualRunning}
                              />

                              <div className="mt-3 rounded-md border border-border/70 bg-surface-muted p-2">
                                <p className="text-[11px] font-semibold">이의제기 재채점</p>
                                <Textarea
                                  className="mt-1 min-h-14"
                                  placeholder="재채점 요청 사유(선택)"
                                  value={appealReasonByKey[key] ?? ""}
                                  onChange={(event) =>
                                    setAppealReasonByKey((prev) => ({
                                      ...prev,
                                      [key]: event.target.value,
                                    }))
                                  }
                                  disabled={isManualRunning || isAppealRunning}
                                />
                                <div className="mt-2 flex items-center gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-8 px-2 text-xs"
                                    onClick={() =>
                                      void submitAppealRegrade(
                                        submission.submission_id,
                                        answer.question_id,
                                        appealReasonByKey[key] ?? null
                                      )
                                    }
                                    disabled={isManualRunning || isAppealRunning}
                                  >
                                    {isAppealRunning ? "재채점 등록 중..." : "이의제기 재채점 요청"}
                                  </Button>
                                  <p className="text-[11px] text-muted-foreground">
                                    동일 모델/프롬프트 버전으로 자동 재채점합니다.
                                  </p>
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
