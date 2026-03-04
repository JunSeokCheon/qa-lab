"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTimeKST } from "@/lib/datetime";

type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
  target_track_name?: string | null;
  question_count: number;
  multiple_choice_score?: number;
  subjective_score?: number;
  coding_score?: number;
  performance_high_min_correct?: number | null;
  performance_mid_min_correct?: number | null;
};

type ExamSubmissionAnswer = {
  question_id: number;
  question_order: number;
  question_type: string;
  prompt_md: string;
  choices: string[] | null;
  correct_choice_index: number | null;
  correct_choice_indexes?: number[];
  answer_key_text: string | null;
  answer_text: string | null;
  selected_choice_index: number | null;
  selected_choice_indexes?: number[];
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
  correctChoiceIndexes: number[];
  counts: number[];
  respondents: string[][];
  unansweredUsers: string[];
  totalResponses: number;
};

type QuestionFilterItem = {
  questionId: number;
  questionOrder: number;
  questionType: string;
  prompt: string;
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

type GradingFeedback = Record<string, unknown> | null;

type NonObjectiveAnswerItem = {
  key: string;
  answer: ExamSubmissionAnswer;
};

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
}

function questionTypeLabel(type: string): string {
  if (type === "multiple_choice") return "객관식";
  if (type === "subjective") return "주관식";
  if (type === "coding") return "코딩";
  return type;
}

function manualGradeKey(submissionId: number, questionId: number): string {
  return `${submissionId}:${questionId}`;
}

function isObjectiveAnswer(answer: ExamSubmissionAnswer): boolean {
  return answer.question_type === "multiple_choice";
}

function isNonObjectiveAnswer(answer: ExamSubmissionAnswer): boolean {
  return !isObjectiveAnswer(answer);
}

function normalizeChoiceIndexes(rawIndexes: number[] | undefined | null): number[] {
  if (!Array.isArray(rawIndexes)) return [];
  const deduped = Array.from(new Set(rawIndexes.filter((value) => Number.isInteger(value))));
  return deduped.sort((a, b) => a - b);
}

function extractSelectedChoiceIndexes(answer: ExamSubmissionAnswer): number[] {
  if (Array.isArray(answer.selected_choice_indexes) && answer.selected_choice_indexes.length > 0) {
    return normalizeChoiceIndexes(answer.selected_choice_indexes);
  }
  if (typeof answer.selected_choice_index === "number") {
    return [answer.selected_choice_index];
  }
  return [];
}

function extractCorrectChoiceIndexes(answer: ExamSubmissionAnswer): number[] {
  if (Array.isArray(answer.correct_choice_indexes) && answer.correct_choice_indexes.length > 0) {
    return normalizeChoiceIndexes(answer.correct_choice_indexes);
  }
  if (typeof answer.correct_choice_index === "number") {
    return [answer.correct_choice_index];
  }
  return [];
}

function isSameChoiceIndexes(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function formatChoiceSummary(indexes: number[], choices: string[] | null): string {
  if (indexes.length === 0) return "-";
  const safeChoices = choices ?? [];
  return indexes
    .map((index) => {
      const choice = safeChoices[index];
      return typeof choice === "string" ? `${index + 1}번 (${choice})` : `${index + 1}번`;
    })
    .join(", ");
}

function isGradingFinished(answer: ExamSubmissionAnswer): boolean {
  return answer.grading_status === "GRADED" || answer.grading_status === "FAILED";
}

function feedbackNeedsReview(answer: ExamSubmissionAnswer): boolean {
  if (!answer.grading_feedback_json || typeof answer.grading_feedback_json !== "object") {
    return false;
  }
  const value = (answer.grading_feedback_json as Record<string, unknown>).needs_review;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on", "y"].includes(value.trim().toLowerCase());
  if (typeof value === "number") return value !== 0;
  return false;
}

function feedbackReviewReason(answer: ExamSubmissionAnswer): string | null {
  if (!answer.grading_feedback_json || typeof answer.grading_feedback_json !== "object") {
    return null;
  }
  const feedback = answer.grading_feedback_json as Record<string, unknown>;
  if (typeof feedback.review_reason_ko === "string" && feedback.review_reason_ko.trim()) {
    return feedback.review_reason_ko.trim();
  }
  if (typeof feedback.fallback_notice === "string" && feedback.fallback_notice.trim()) {
    return feedback.fallback_notice.trim();
  }
  return null;
}

function collectNonObjectiveAnswers(rows: ExamSubmission[]): NonObjectiveAnswerItem[] {
  const items: NonObjectiveAnswerItem[] = [];
  for (const submission of rows) {
    for (const answer of submission.answers) {
      if (!isNonObjectiveAnswer(answer)) continue;
      items.push({
        key: manualGradeKey(submission.submission_id, answer.question_id),
        answer,
      });
    }
  }
  return items;
}

function extractManualOverrideIsCorrect(answer: ExamSubmissionAnswer): boolean | null {
  const feedback = answer.grading_feedback_json;
  if (!feedback || typeof feedback !== "object") return null;
  const source = feedback.source;
  if (source !== "manual") return null;
  if (typeof feedback.is_correct === "boolean") return feedback.is_correct;
  return null;
}

function resolveAnswerVerdict(answer: ExamSubmissionAnswer): AnswerVerdict {
  const manualOverride = extractManualOverrideIsCorrect(answer);
  if (manualOverride !== null) {
    return manualOverride
      ? { label: "\uC815\uB2F5", className: "bg-emerald-100 text-emerald-800" }
      : { label: "\uC624\uB2F5", className: "bg-rose-100 text-rose-800" };
  }

  if (isObjectiveAnswer(answer)) {
    const selectedChoiceIndexes = extractSelectedChoiceIndexes(answer);
    const correctChoiceIndexes = extractCorrectChoiceIndexes(answer);
    if (selectedChoiceIndexes.length === 0 || correctChoiceIndexes.length === 0) {
      return { label: "미응답", className: "bg-muted text-muted-foreground" };
    }
    if (isSameChoiceIndexes(selectedChoiceIndexes, correctChoiceIndexes)) {
      return { label: "정답", className: "bg-emerald-100 text-emerald-800" };
    }
    return { label: "오답", className: "bg-rose-100 text-rose-800" };
  }

  if (answer.grading_status === "FAILED") {
    return { label: "오답", className: "bg-rose-100 text-rose-800" };
  }
  if (answer.grading_status !== "GRADED") {
    return { label: "미채점", className: "bg-muted text-muted-foreground" };
  }
  if (feedbackNeedsReview(answer)) {
    return { label: "검토 필요", className: "bg-amber-100 text-amber-800" };
  }

  if (answer.grading_score === answer.grading_max_score) {
    return { label: "정답", className: "bg-emerald-100 text-emerald-800" };
  }
  return { label: "오답", className: "bg-rose-100 text-rose-800" };
}

type ExportCell = string | number | null | undefined;
type ExportGrade = "상" | "중" | "하" | "미설정";
type ExportQuestionType = "multiple_choice" | "subjective" | "coding";
type ExportQuestion = {
  id: number;
  order: number;
  type: ExportQuestionType;
  score: number;
};
type StudentScoreRow = {
  userName: string;
  values: number[];
  correctCount: number;
  correctRate: number;
  weightedScore: number;
  normalizedScore: number;
  grade: ExportGrade;
};
type ExportLayout = {
  rows: ExportCell[][];
  questions: ExportQuestion[];
  studentRows: StudentScoreRow[];
  studentStartRowIndex: number;
  totalColumns: number;
};

const TOP_HEADER_COLOR = "#5C5C5C";
const SUMMARY_ROW_COLOR = "#EEEEEE";
const TYPE_HEADER_COLORS: Record<ExportQuestionType, string> = {
  multiple_choice: "#D9D9D9",
  subjective: "#F7B731",
  coding: "#9CC3E6",
};
const GRADE_ROW_COLORS: Record<ExportGrade, string> = {
  상: "#DDF1DD",
  중: "#F6EAC8",
  하: "#F7D8D8",
  미설정: "#ECECEC",
};
const GRADE_ORDER: Record<ExportGrade, number> = {
  상: 0,
  중: 1,
  하: 2,
  미설정: 3,
};

type ExportCellStyle = {
  backgroundColor: string;
  textColor: string;
  bold: boolean;
  align: "left" | "center";
};

function normalizeExportQuestionType(type: string): ExportQuestionType {
  if (type === "multiple_choice") return "multiple_choice";
  if (type === "subjective") return "subjective";
  return "coding";
}

function isFullyCorrect(answer: ExamSubmissionAnswer): boolean {
  const manualOverride = extractManualOverrideIsCorrect(answer);
  if (manualOverride !== null) return manualOverride;

  if (isObjectiveAnswer(answer)) {
    const selectedChoiceIndexes = extractSelectedChoiceIndexes(answer);
    const correctChoiceIndexes = extractCorrectChoiceIndexes(answer);
    return selectedChoiceIndexes.length > 0 && isSameChoiceIndexes(selectedChoiceIndexes, correctChoiceIndexes);
  }

  return (
    answer.grading_status === "GRADED" &&
    !feedbackNeedsReview(answer) &&
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

function translateEnglishReasonToKorean(reason: string, isCorrect: boolean): string {
  const normalized = reason.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return isCorrect ? "정답입니다." : "오답입니다. 정답 기준과 일치하지 않습니다.";
  }

  const lower = normalized.toLowerCase();
  if (/(quota|billing|status=429|too many requests)/.test(lower)) {
    return "오답입니다. 인공지능 채점 사용량 한도로 자동 채점이 제한되어 대체 채점이 적용되었습니다.";
  }
  if (/timeout|time out|timed out/.test(lower)) {
    return "오답입니다. 채점 요청 시간이 초과되어 정상 채점이 완료되지 않았습니다.";
  }
  if (/syntaxerror/.test(lower)) {
    return "오답입니다. 코드 문법 오류(SyntaxError)가 있어 실행되지 않았습니다.";
  }
  if (/nameerror/.test(lower)) {
    return "오답입니다. 정의되지 않은 변수/함수(NameError)가 포함되어 있습니다.";
  }
  if (/typeerror/.test(lower)) {
    return "오답입니다. 자료형 처리(TypeError)에 문제가 있습니다.";
  }
  if (/valueerror/.test(lower)) {
    return "오답입니다. 값 처리(ValueError)에 문제가 있습니다.";
  }
  if (/indexerror/.test(lower)) {
    return "오답입니다. 인덱스 범위(IndexError)를 벗어났습니다.";
  }
  if (/keyerror/.test(lower)) {
    return "오답입니다. 사전에 없는 키(KeyError)를 참조했습니다.";
  }
  if (/assertionerror|assert failed|failed case/.test(lower)) {
    return "오답입니다. 채점 기준 테스트를 통과하지 못했습니다.";
  }

  const converted = normalized
    .replace(/^the student\s+/i, "수강생은 ")
    .replace(/\bcorrectly\b/gi, "정확하게")
    .replace(/\bhowever\b/gi, "다만")
    .replace(/\bomitted\b/gi, "누락했습니다")
    .replace(/\brequired\b/gi, "필수로 요구된")
    .replace(/\bmissing\b/gi, "누락된")
    .replace(/\bprint statement\b/gi, "출력 구문")
    .replace(/\bcolumn names\b/gi, "컬럼명")
    .replace(/\bprompt\b/gi, "문항 요구사항")
    .replace(/\banswer key\b/gi, "정답 기준");

  if (/[가-힣]/.test(converted)) return converted;
  return isCorrect
    ? "정답입니다."
    : `오답입니다. 원본 채점 로그 요약: ${normalized.slice(0, 180)}`;
}

function summarizeReasonFromLogs(logs: string | null | undefined, isCorrect: boolean): string | null {
  if (!logs || !logs.trim()) return null;

  const lines = logs
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "[stdout]" && line !== "[stderr]");
  if (lines.length === 0) return null;

  const preferredPrefixes = ["wrong_reason_ko=", "reason=", "fallback_notice=", "llm_error=", "issues="];
  for (const prefix of preferredPrefixes) {
    const matched = lines.find((line) => line.toLowerCase().startsWith(prefix));
    if (!matched) continue;
    const reasonPart = matched.slice(matched.indexOf("=") + 1).trim();
    if (reasonPart) return translateEnglishReasonToKorean(reasonPart, isCorrect);
  }

  const meaningful = lines.find((line) => !line.startsWith("score=") && !line.startsWith("prompt_version=")) ?? lines[0];
  return translateEnglishReasonToKorean(meaningful, isCorrect);
}

function toKoreanReason(reason: string, isCorrect: boolean, gradingLogs?: string | null): string {
  const trimmed = reason.trim();
  if (!trimmed) {
    return summarizeReasonFromLogs(gradingLogs, isCorrect) ?? (isCorrect ? "정답입니다." : "오답입니다. 정답 기준과 일치하지 않습니다.");
  }
  if (/[가-힣]/.test(trimmed)) return trimmed;
  return translateEnglishReasonToKorean(trimmed, isCorrect);
}

function summarizeNonObjectiveReason(answer: ExamSubmissionAnswer): string {
  if (!isGradingFinished(answer)) {
    return "아직 자동 채점이 시작되지 않았습니다. 관리자 승인 후 채점됩니다.";
  }

  if (feedbackNeedsReview(answer)) {
    return feedbackReviewReason(answer) ?? "자동 채점 결과가 경계 구간이라 검토가 필요합니다.";
  }

  const feedback = answer.grading_feedback_json as GradingFeedback;
  const isCorrect = isFullyCorrect(answer);

  if (feedback && typeof feedback.wrong_reason_ko === "string" && feedback.wrong_reason_ko.trim()) {
    return toKoreanReason(feedback.wrong_reason_ko, isCorrect, answer.grading_logs);
  }
  if (feedback && typeof feedback.reason === "string" && feedback.reason.trim()) {
    return toKoreanReason(feedback.reason, isCorrect, answer.grading_logs);
  }
  if (feedback && typeof feedback.note === "string" && feedback.note.trim()) {
    return toKoreanReason(feedback.note, isCorrect, answer.grading_logs);
  }

  const fallbackReasonCode =
    feedback && typeof feedback.fallback_reason_code === "string" ? feedback.fallback_reason_code : "";
  const fallbackUsed = feedback && feedback.fallback_used === true;
  if (fallbackUsed && fallbackReasonCode === "quota") {
    const notice =
      feedback && typeof feedback.fallback_notice === "string" ? feedback.fallback_notice.trim() : "";
    return notice || "인공지능 채점 사용량 한도로 대체 채점이 적용되었습니다. 결제/쿼터 확인 후 재채점할 수 있습니다.";
  }

  if (isFullyCorrect(answer)) {
    return "정답입니다. 정답 기준을 충족했습니다.";
  }

  const fromLogs = summarizeReasonFromLogs(answer.grading_logs, false);
  if (fromLogs) return fromLogs;

  return "오답입니다. 정답 기준과 일치하지 않습니다.";
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

function roundNumber(value: number, digits = 10): number {
  return Number(value.toFixed(digits));
}

function percentText(ratio: number, digits = 0): string {
  const scaled = ratio * 100;
  const rounded = digits > 0 ? roundNumber(scaled, digits) : Math.round(scaled);
  return `${rounded}%`;
}

function numericSafe(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function stripCsvStyleHints(text: string): string {
  // CSV is plain text only; remove legacy style hint suffixes if any stale values remain.
  return text.replace(/\s*\[(회색|주황|파랑|연녹색|연베이지|연핑크|연회색)\]/g, "");
}

function csvCell(value: ExportCell): string {
  const text = stripCsvStyleHints(value === null || value === undefined ? "" : String(value));
  if (text.includes('"') || text.includes(",") || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsv(rows: ExportCell[][]): string {
  const lines = rows.map((row) => row.map((value) => csvCell(value)).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}

function getExportCellStyle(layout: ExportLayout, rowIndex: number, colIndex: number): ExportCellStyle {
  const isNameColumn = colIndex === 0;
  const summaryStartCol = layout.questions.length + 1;
  const studentRowOffset = rowIndex - layout.studentStartRowIndex;
  const studentRow = studentRowOffset >= 0 ? layout.studentRows[studentRowOffset] : null;

  if (rowIndex === 0 || rowIndex === 1) {
    return {
      backgroundColor: TOP_HEADER_COLOR,
      textColor: "#FFFFFF",
      bold: true,
      align: isNameColumn ? "left" : "center",
    };
  }

  if (rowIndex === 2) {
    if (colIndex >= 1 && colIndex <= layout.questions.length) {
      const questionType = layout.questions[colIndex - 1]?.type ?? "multiple_choice";
      return {
        backgroundColor: TYPE_HEADER_COLORS[questionType],
        textColor: "#111111",
        bold: true,
        align: "center",
      };
    }
    return {
      backgroundColor: TOP_HEADER_COLOR,
      textColor: "#FFFFFF",
      bold: true,
      align: colIndex >= summaryStartCol ? "center" : "left",
    };
  }

  if (rowIndex >= 3 && rowIndex <= 5) {
    return {
      backgroundColor: SUMMARY_ROW_COLOR,
      textColor: "#111111",
      bold: true,
      align: isNameColumn ? "left" : "center",
    };
  }

  if (studentRow) {
    return {
      backgroundColor: GRADE_ROW_COLORS[studentRow.grade],
      textColor: "#111111",
      bold: colIndex === layout.totalColumns - 1,
      align: isNameColumn ? "left" : "center",
    };
  }

  return {
    backgroundColor: "#FFFFFF",
    textColor: "#111111",
    bold: false,
    align: isNameColumn ? "left" : "center",
  };
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadText(content: string, fileName: string, mimeType: string): void {
  downloadBlob(new Blob([content], { type: mimeType }), fileName);
}

type AdminExamDashboardProps = {
  initialExams: ExamSummary[];
  initialExamId?: number;
  initialStudentName?: string;
  initialNeedsReviewOnly?: boolean;
};

export function AdminExamDashboard({
  initialExams,
  initialExamId,
  initialStudentName,
  initialNeedsReviewOnly,
}: AdminExamDashboardProps) {
  const initialExamIdValue =
    typeof initialExamId === "number" && initialExams.some((item) => item.id === initialExamId)
      ? initialExamId
      : (initialExams[0]?.id ?? null);
  const [exams] = useState(initialExams);
  const [examId, setExamId] = useState<number | null>(initialExamIdValue);
  const [submissions, setSubmissions] = useState<ExamSubmission[]>([]);
  const [questionFilter, setQuestionFilter] = useState<string>("all");
  const [studentFilter, setStudentFilter] = useState<string>(initialStudentName ?? "all");
  const [studentSearchKeyword, setStudentSearchKeyword] = useState("");
  const [needsReviewOnly, setNeedsReviewOnly] = useState(Boolean(initialNeedsReviewOnly));
  const [manualNoteByKey, setManualNoteByKey] = useState<Record<string, string>>({});
  const [manualRunningKeys, setManualRunningKeys] = useState<Set<string>>(new Set());
  const [appealReasonByKey, setAppealReasonByKey] = useState<Record<string, string>>({});
  const [appealRunningKeys, setAppealRunningKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [downloadingXlsx, setDownloadingXlsx] = useState(false);
  const selectedExam = useMemo(() => exams.find((item) => item.id === examId) ?? null, [examId, exams]);
  const performanceCutSummary = useMemo(() => {
    if (!selectedExam) return "";
    const high = selectedExam.performance_high_min_correct;
    const mid = selectedExam.performance_mid_min_correct;
    if (!Number.isInteger(high) || !Number.isInteger(mid) || (high ?? 0) <= (mid ?? 0)) {
      return "미설정";
    }
    return `상: ${high}개 이상, 중: ${mid}개 이상`;
  }, [selectedExam]);

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
        return null;
      }

      const rows = payload as ExamSubmission[];
      const nonObjectiveAnswers = collectNonObjectiveAnswers(rows);

      setSubmissions(rows);
      setManualNoteByKey((prev) => {
        const next: Record<string, string> = {};
        for (const item of nonObjectiveAnswers) {
          next[item.key] = prev[item.key] ?? "";
        }
        return next;
      });
      setAppealReasonByKey((prev) => {
        const next: Record<string, string> = {};
        for (const item of nonObjectiveAnswers) {
          next[item.key] = prev[item.key] ?? "";
        }
        return next;
      });
      return rows;
    } catch {
      setError("시험 제출 목록을 불러오지 못했습니다.");
      setSubmissions([]);
      return null;
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
            correctChoiceIndexes: extractCorrectChoiceIndexes(answer),
            counts: choices.map(() => 0),
            respondents: choices.map(() => [] as string[]),
            unansweredUsers: [],
            totalResponses: 0,
          });
        }

        const stat = byQuestion.get(answer.question_id);
        if (!stat) continue;
        if (stat.correctChoiceIndexes.length === 0) {
          stat.correctChoiceIndexes = extractCorrectChoiceIndexes(answer);
        }
        const selectedIndexes = extractSelectedChoiceIndexes(answer).filter(
          (index) => index >= 0 && index < stat.choices.length
        );
        const userName = row.user_name;
        if (selectedIndexes.length === 0) {
          stat.unansweredUsers.push(userName);
          continue;
        }
        for (const selected of selectedIndexes) {
          stat.counts[selected] += 1;
          stat.respondents[selected].push(userName);
        }
        stat.totalResponses += 1;
      }
    }
    return [...byQuestion.values()].sort((a, b) => a.questionOrder - b.questionOrder);
  }, [submissions]);

  const allQuestionOptions = useMemo(() => {
    const byQuestion = new Map<number, QuestionFilterItem>();
    for (const row of submissions) {
      for (const answer of row.answers) {
        if (!byQuestion.has(answer.question_id)) {
          byQuestion.set(answer.question_id, {
            questionId: answer.question_id,
            questionOrder: answer.question_order,
            questionType: answer.question_type,
            prompt: answer.prompt_md,
          });
        }
      }
    }
    return [...byQuestion.values()].sort((a, b) => a.questionOrder - b.questionOrder);
  }, [submissions]);

  const questionOptions = useMemo(
    () =>
      allQuestionOptions.map((item) => ({
        value: String(item.questionId),
        label: `${item.questionOrder}번 문항 (${questionTypeLabel(item.questionType)})`,
      })),
    [allQuestionOptions]
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

  const selectedQuestionOption = useMemo(() => {
    if (questionFilter === "all") return null;
    const questionId = Number(questionFilter);
    return allQuestionOptions.find((item) => item.questionId === questionId) ?? null;
  }, [allQuestionOptions, questionFilter]);

  const needsReviewFilterActive =
    needsReviewOnly && !(selectedQuestionOption && selectedQuestionOption.questionType === "multiple_choice");

  const filteredSubmissions = useMemo(() => {
    const keyword = studentSearchKeyword.trim().toLocaleLowerCase("ko");
    return submissions.filter((row) => {
      if (studentFilter !== "all" && row.user_name !== studentFilter) return false;
      const visibleAnswers =
        questionFilter === "all"
          ? row.answers
          : row.answers.filter((answer) => answer.question_id === Number(questionFilter));
      if (
        needsReviewFilterActive &&
        !visibleAnswers.some((answer) => isNonObjectiveAnswer(answer) && feedbackNeedsReview(answer))
      ) {
        return false;
      }
      if (!keyword) return true;
      return (
        row.user_name.toLocaleLowerCase("ko").includes(keyword) ||
        row.username.toLocaleLowerCase("ko").includes(keyword)
      );
    });
  }, [needsReviewFilterActive, questionFilter, studentFilter, studentSearchKeyword, submissions]);

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

  const scoringWeights = useMemo(
    () => ({
      multipleChoice: Number.isInteger(selectedExam?.multiple_choice_score) ? (selectedExam?.multiple_choice_score ?? 1) : 1,
      subjective: Number.isInteger(selectedExam?.subjective_score) ? (selectedExam?.subjective_score ?? 3) : 3,
      coding: Number.isInteger(selectedExam?.coding_score) ? (selectedExam?.coding_score ?? 3) : 3,
    }),
    [selectedExam?.coding_score, selectedExam?.multiple_choice_score, selectedExam?.subjective_score]
  );

  const exportQuestions = useMemo<ExportQuestion[]>(
    () =>
      allQuestionOptions.map((item) => {
        const type = normalizeExportQuestionType(item.questionType);
        const score =
          type === "multiple_choice"
            ? scoringWeights.multipleChoice
            : type === "subjective"
              ? scoringWeights.subjective
              : scoringWeights.coding;
        return {
          id: item.questionId,
          order: item.questionOrder,
          type,
          score,
        };
      }),
    [allQuestionOptions, scoringWeights.coding, scoringWeights.multipleChoice, scoringWeights.subjective]
  );

  const totalWeightedMaxScore = useMemo(
    () => exportQuestions.reduce((sum, question) => sum + question.score, 0),
    [exportQuestions]
  );

  const scoringCut = useMemo(() => {
    const high = selectedExam?.performance_high_min_correct;
    const mid = selectedExam?.performance_mid_min_correct;
    if (!Number.isInteger(high) || !Number.isInteger(mid) || (high ?? 0) <= (mid ?? 0)) {
      return null;
    }
    return {
      high: high as number,
      mid: mid as number,
    };
  }, [selectedExam?.performance_high_min_correct, selectedExam?.performance_mid_min_correct]);

  const studentScoreRows = useMemo<StudentScoreRow[]>(() => {
    const questionCount = exportQuestions.length;
    const rows: StudentScoreRow[] = submissions.map((submission) => {
      const answerMap = new Map<number, ExamSubmissionAnswer>(
        submission.answers.map((answer) => [answer.question_id, answer])
      );
      const values = exportQuestions.map((question) => toBinaryCorrect(answerMap.get(question.id)));
      const correctCount = values.reduce((sum, value) => sum + value, 0);
      const correctRate = questionCount > 0 ? correctCount / questionCount : 0;
      const weightedScore = values.reduce((sum, value, index) => sum + value * (exportQuestions[index]?.score ?? 0), 0);
      const normalizedScore = totalWeightedMaxScore > 0 ? weightedScore / totalWeightedMaxScore : 0;
      const grade: ExportGrade = scoringCut
        ? correctCount >= scoringCut.high
          ? "상"
          : correctCount >= scoringCut.mid
            ? "중"
            : "하"
        : "미설정";

      return {
        userName: submission.user_name,
        values,
        correctCount,
        correctRate,
        weightedScore,
        normalizedScore,
        grade,
      };
    });

    return rows.sort((left, right) => {
      const byGrade = GRADE_ORDER[left.grade] - GRADE_ORDER[right.grade];
      if (byGrade !== 0) return byGrade;
      if (left.normalizedScore !== right.normalizedScore) {
        return right.normalizedScore - left.normalizedScore;
      }
      return left.userName.localeCompare(right.userName, "ko");
    });
  }, [exportQuestions, scoringCut, submissions, totalWeightedMaxScore]);

  const exportLayout = useMemo<ExportLayout | null>(() => {
    if (exportQuestions.length === 0) return null;

    const questionCount = exportQuestions.length;
    const totalColumns = questionCount + 6;
    const questionSums = new Array(questionCount).fill(0);
    for (const student of studentScoreRows) {
      student.values.forEach((value, index) => {
        questionSums[index] += value;
      });
    }
    const questionRates =
      studentScoreRows.length > 0
        ? questionSums.map((sum) => sum / studentScoreRows.length)
        : questionSums.map(() => 0);

    const averageCorrectCount =
      studentScoreRows.length > 0
        ? roundNumber(
            studentScoreRows.reduce((sum, row) => sum + row.correctCount, 0) / studentScoreRows.length,
            1
          )
        : 0;
    const averageCorrectRate =
      studentScoreRows.length > 0
        ? studentScoreRows.reduce((sum, row) => sum + row.correctRate, 0) / studentScoreRows.length
        : 0;
    const averageWeightedScore =
      studentScoreRows.length > 0
        ? roundNumber(
            studentScoreRows.reduce((sum, row) => sum + row.weightedScore, 0) / studentScoreRows.length,
            1
          )
        : 0;
    const averageNormalizedScore =
      studentScoreRows.length > 0
        ? studentScoreRows.reduce((sum, row) => sum + row.normalizedScore, 0) / studentScoreRows.length
        : 0;

    const questionHeaders = exportQuestions.map((question) => `${question.order}번`);
    const questionTypeHeaders = exportQuestions.map(
      (question) => `${questionTypeLabel(question.type)}\n(${question.score}점)`
    );
    const topRow: ExportCell[] = new Array(totalColumns).fill("");
    topRow[1] = "문항별 채점";
    topRow[questionCount + 3] = "최종성적";

    const rows: ExportCell[][] = [
      topRow,
      [
        "수강생",
        ...questionHeaders,
        "합계",
        "정답률",
        "합산점수",
        "합산점수(100점 환산)",
        "등급",
      ],
      ["", ...questionTypeHeaders, "", "", "", "", ""],
      [
        "전체 평균 점수(100점 환산)",
        ...new Array(questionCount).fill(""),
        averageCorrectCount,
        percentText(averageCorrectRate),
        averageWeightedScore,
        percentText(averageNormalizedScore),
        "",
      ],
      ["합계", ...questionSums, "", "", "", "", ""],
      ["정답률(%)", ...questionRates.map((ratio) => percentText(ratio)), "", "", "", "", ""],
    ];

    for (const student of studentScoreRows) {
      rows.push([
        student.userName,
        ...student.values,
        student.correctCount,
        percentText(student.correctRate),
        numericSafe(student.weightedScore),
        percentText(student.normalizedScore),
        student.grade,
      ]);
    }

    return {
      rows,
      questions: exportQuestions,
      studentRows: studentScoreRows,
      studentStartRowIndex: 6,
      totalColumns,
    };
  }, [exportQuestions, studentScoreRows]);

  const buildExportFileBaseName = useCallback(() => {
    if (!selectedExam) return "";
    const fileTitle = selectedExam.title.replace(/[\/:*?"<>|]/g, "-").replace(/\s+/g, "_").slice(0, 40);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return `${fileTitle || `exam-${selectedExam.id}`}_응시결과_${timestamp}`;
  }, [selectedExam]);

  const onDownloadCsv = () => {
    if (!selectedExam || !exportLayout) return;
    const csv = buildCsv(exportLayout.rows);
    downloadText(csv, `${buildExportFileBaseName()}.csv`, "text/csv;charset=utf-8;");
  };

  const onDownloadExcelXlsx = async () => {
    if (!selectedExam || !exportLayout || downloadingXlsx) return;

    setActionError("");
    setActionMessage("");
    setDownloadingXlsx(true);
    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("응시결과");

      for (const row of exportLayout.rows) {
        worksheet.addRow(row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
      }

      const questionCount = exportLayout.questions.length;
      worksheet.mergeCells(1, 2, 1, questionCount + 3);
      worksheet.mergeCells(1, questionCount + 4, 1, exportLayout.totalColumns);
      worksheet.views = [{ state: "frozen", ySplit: 6, xSplit: 1 }];

      worksheet.getColumn(1).width = 16;
      for (let index = 0; index < questionCount; index += 1) {
        worksheet.getColumn(index + 2).width = 8;
      }
      worksheet.getColumn(questionCount + 2).width = 8;
      worksheet.getColumn(questionCount + 3).width = 9;
      worksheet.getColumn(questionCount + 4).width = 10;
      worksheet.getColumn(questionCount + 5).width = 16;
      worksheet.getColumn(questionCount + 6).width = 8;

      for (let rowIndex = 0; rowIndex < exportLayout.rows.length; rowIndex += 1) {
        for (let colIndex = 0; colIndex < exportLayout.totalColumns; colIndex += 1) {
          const cell = worksheet.getCell(rowIndex + 1, colIndex + 1);
          const style = getExportCellStyle(exportLayout, rowIndex, colIndex);
          const fillColor = style.backgroundColor.replace("#", "").toUpperCase();
          const textColor = style.textColor.replace("#", "").toUpperCase();

          cell.font = {
            bold: style.bold,
            color: { argb: textColor.length === 6 ? `FF${textColor}` : "FF111111" },
          };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: fillColor.length === 6 ? `FF${fillColor}` : "FFFFFFFF" },
          };
          cell.alignment = {
            horizontal: style.align,
            vertical: "middle",
            wrapText: true,
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FF222222" } },
            left: { style: "thin", color: { argb: "FF222222" } },
            bottom: { style: "thin", color: { argb: "FF222222" } },
            right: { style: "thin", color: { argb: "FF222222" } },
          };
        }
      }

      const buffer = await workbook.xlsx.writeBuffer();
      downloadBlob(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `${buildExportFileBaseName()}.xlsx`
      );
      setActionMessage("엑셀(.xlsx) 다운로드를 시작했습니다.");
    } catch {
      setActionError("엑셀(.xlsx) 생성 중 오류가 발생했습니다.");
    } finally {
      setDownloadingXlsx(false);
    }
  };

  const submitManualGrade = async (
    submissionId: number,
    questionId: number,
    isCorrect: boolean,
    note: string | null
  ) => {
    if (examId === null) return;

    const key = manualGradeKey(submissionId, questionId);
    const normalizedNote = note?.trim() ? note.trim() : null;

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
            is_correct: isCorrect,
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

  const waitForAppealRegradeResult = useCallback(
    async (targetExamId: number, submissionId: number, questionId: number) => {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const reloaded = await loadSubmissions(targetExamId);
        if (reloaded) {
          const targetSubmission = reloaded.find((item) => item.submission_id === submissionId);
          const targetAnswer = targetSubmission?.answers.find((item) => item.question_id === questionId);
          if (targetAnswer && targetAnswer.grading_status && !["QUEUED", "RUNNING"].includes(targetAnswer.grading_status)) {
            return true;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      return false;
    },
    [loadSubmissions]
  );

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

      setActionMessage("재채점을 진행 중입니다. 잠시만 기다려 주세요.");
      const completed = await waitForAppealRegradeResult(examId, submissionId, questionId);
      setActionMessage(
        completed
          ? "해당 문항 재채점이 완료되어 결과를 반영했습니다."
          : (payload.message ?? "이의제기 재채점 요청을 등록했습니다. 잠시 후 다시 확인해 주세요.")
      );
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
                setNeedsReviewOnly(false);
              }}
            >
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title} ({examKindLabel(exam.exam_kind)} / {exam.target_track_name ?? "미지정"})
                </option>
              ))}
            </select>

            <select
              className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
              value={questionFilter}
              onChange={(event) => setQuestionFilter(event.target.value)}
            >
              <option value="all">전체 문항</option>
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
            <label className="flex h-11 items-center gap-2 rounded-xl border border-border/70 px-3 text-sm">
              <input
                type="checkbox"
                checked={needsReviewOnly}
                onChange={(event) => setNeedsReviewOnly(event.target.checked)}
              />
              검토 필요만 보기
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onDownloadCsv} disabled={loading || !exportLayout}>
              CSV 다운로드
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void onDownloadExcelXlsx()}
              disabled={loading || !exportLayout || downloadingXlsx}
            >
              {downloadingXlsx ? "엑셀 준비 중..." : "엑셀 다운로드"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">상/중/하 기준: {performanceCutSummary}</p>
          <p className="text-xs text-muted-foreground">
            응시자 수: {submissions.length}명
            {studentFilter !== "all" || studentSearchKeyword.trim().length > 0 || needsReviewFilterActive
              ? ` | 필터 적용: ${filteredSubmissions.length}명`
              : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            배점: 객관식 {scoringWeights.multipleChoice}점 / 주관식 {scoringWeights.subjective}점 / 코딩 {scoringWeights.coding}점
          </p>
          <p className="text-xs text-muted-foreground">
            CSV/엑셀 모두 동일한 텍스트 구조(문항별 채점 + 최종성적)를 제공합니다.
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
        {questionFilter !== "all" && selectedQuestionOption?.questionType !== "multiple_choice" ? (
          <p className="text-sm text-muted-foreground">선택한 문항은 객관식이 아니어서 객관식 통계를 표시할 수 없습니다.</p>
        ) : filteredQuestionStats.length === 0 ? (
          <p className="text-sm text-muted-foreground">객관식 응답 데이터가 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {filteredQuestionStats.map((stat) => (
              <article key={stat.questionId} className="rounded-xl border border-border/70 bg-surface p-3">
                <div className="text-sm font-semibold">
                  <span>{stat.questionOrder}. </span>
                  <MarkdownContent className="inline space-y-0" textClassName="inline text-sm leading-6" content={stat.prompt} />
                </div>
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
                            {stat.correctChoiceIndexes.includes(index) ? " (정답)" : ""}
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
                  {submission.user_name} ({formatDateTimeKST(submission.submitted_at)})
                </p>
                <div className="mt-2 space-y-2">
                  {submission.answers
                    .filter((answer) => (questionFilter === "all" ? true : answer.question_id === Number(questionFilter)))
                    .filter((answer) =>
                      needsReviewFilterActive ? isNonObjectiveAnswer(answer) && feedbackNeedsReview(answer) : true
                    )
                    .map((answer) => {
                      const key = manualGradeKey(submission.submission_id, answer.question_id);
                      const verdict = resolveAnswerVerdict(answer);
                      const isManualTarget = true;
                      const isAppealRegradeTarget = answer.question_type !== "multiple_choice";
                      const isManualRunning = manualRunningKeys.has(key);
                      const isAppealRunning = appealRunningKeys.has(key);

                      return (
                        <div key={key} className="rounded-lg bg-surface-muted p-2 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 font-medium">
                              <span>{answer.question_order}. </span>
                              <MarkdownContent className="inline space-y-0" textClassName="inline text-xs leading-5" content={answer.prompt_md} />
                            </div>
                            <span
                              className={`mt-0.5 inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${verdict.className}`}
                            >
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
                              제출 답: {formatChoiceSummary(extractSelectedChoiceIndexes(answer), answer.choices)}
                            </p>
                          ) : null}
                          {answer.question_type === "multiple_choice" ? (
                            <p className="mt-1 text-muted-foreground">
                              정답: {formatChoiceSummary(extractCorrectChoiceIndexes(answer), answer.choices)}
                            </p>
                          ) : null}
                          {answer.question_type !== "multiple_choice" ? (
                            <p className="mt-1 text-muted-foreground">
                              채점 상태: {answer.grading_status ?? "미채점"}
                            </p>
                          ) : null}
                          {answer.graded_at ? (
                            <p className="mt-1 text-muted-foreground">
                              채점 시각: {formatDateTimeKST(answer.graded_at)}
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
                                {answer.grading_status === "GRADED" || answer.grading_status === "FAILED"
                                  ? feedbackNeedsReview(answer)
                                    ? "검토 필요 사유"
                                    : isFullyCorrect(answer)
                                      ? "정답 이유"
                                      : "오답 이유"
                                  : "판정 사유"}
                              </p>
                              <p className="mt-1 whitespace-pre-wrap rounded bg-surface-muted p-2 text-[11px]">
                                {summarizeNonObjectiveReason(answer)}
                              </p>

                            </div>
                          ) : null}

                          {isManualTarget ? (
                            <div className="mt-2 rounded-md border border-border/70 bg-background/70 p-2">
                              <p className="font-medium">수동 채점</p>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  onClick={() =>
                                    void submitManualGrade(submission.submission_id, answer.question_id, true, manualNoteByKey[key] ?? null)
                                  }
                                  disabled={isManualRunning}
                                >
                                  {isManualRunning ? "처리 중..." : "정답 처리"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 px-2 text-xs"
                                  onClick={() =>
                                    void submitManualGrade(submission.submission_id, answer.question_id, false, manualNoteByKey[key] ?? null)
                                  }
                                  disabled={isManualRunning}
                                >
                                  {isManualRunning ? "처리 중..." : "오답 처리"}
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

                              {isAppealRegradeTarget ? (
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
                                      해당 문항만 즉시 재채점하며, 이의제기는 다른 모델을 사용해서 처리합니다.
                                    </p>
                                  </div>
                                </div>
                              ) : null}
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

