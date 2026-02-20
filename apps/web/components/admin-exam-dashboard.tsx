"use client";

import { useEffect, useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";

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
  answer_text: string | null;
  selected_choice_index: number | null;
  grading_status: string | null;
  grading_score: number | null;
  grading_max_score: number | null;
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

function examKindLabel(kind: string): string {
  if (kind === "quiz") return "퀴즈";
  if (kind === "assessment") return "성취도 평가";
  return kind;
}

type ExportCell = string | number | null | undefined;
type ExportRow = Record<string, ExportCell>;

function toBinaryCorrect(answer: ExamSubmissionAnswer | undefined): number {
  if (!answer) return 0;

  if (answer.question_type === "multiple_choice") {
    if (answer.correct_choice_index === null || answer.selected_choice_index === null) return 0;
    return answer.selected_choice_index === answer.correct_choice_index ? 1 : 0;
  }

  if (answer.question_type === "coding") {
    if (answer.grading_status !== "GRADED") return 0;
    if (answer.grading_score === null || answer.grading_max_score === null) return 0;
    return answer.grading_score === answer.grading_max_score ? 1 : 0;
  }

  return 0;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedExam = useMemo(() => exams.find((item) => item.id === examId) ?? null, [examId, exams]);

  useEffect(() => {
    if (examId === null) {
      return;
    }

    void (async () => {
      setLoading(true);
      setError("");
      const response = await fetch(`/api/admin/exams/${examId}/submissions`, { cache: "no-store" });
      const payload = (await response.json().catch(() => [])) as
        | ExamSubmission[]
        | { detail?: string; message?: string };
      if (!response.ok) {
        const messagePayload = payload as { detail?: string; message?: string };
        setError(messagePayload.detail ?? messagePayload.message ?? "시험 제출 목록을 불러오지 못했습니다.");
        setSubmissions([]);
        setLoading(false);
        return;
      }
      setSubmissions(payload as ExamSubmission[]);
      setLoading(false);
    })();
  }, [examId]);

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

  const filteredQuestionStats = useMemo(() => {
    if (questionFilter === "all") return questionStats;
    const questionId = Number(questionFilter);
    return questionStats.filter((item) => item.questionId === questionId);
  }, [questionFilter, questionStats]);

  const filteredSubmissions = useMemo(() => {
    if (studentFilter === "all") return submissions;
    return submissions.filter((row) => row.user_name === studentFilter);
  }, [studentFilter, submissions]);

  const correctCountDistribution = useMemo(() => {
    const targetQuestionIds = new Set(
      (questionFilter === "all" ? questionStats : filteredQuestionStats).map((item) => item.questionId)
    );
    const buckets = new Map<number, { count: number; users: string[] }>();

    for (const row of filteredSubmissions) {
      let correct = 0;
      for (const answer of row.answers) {
        if (answer.question_type !== "multiple_choice") continue;
        if (!targetQuestionIds.has(answer.question_id)) continue;
        if (answer.correct_choice_index === null) continue;
        if (answer.selected_choice_index === answer.correct_choice_index) {
          correct += 1;
        }
      }

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
  }, [filteredQuestionStats, filteredSubmissions, questionFilter, questionStats]);

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

      {exams.length === 0 ? (
        <section className="qa-card">
          <p className="text-sm text-muted-foreground">등록된 시험이 없습니다.</p>
        </section>
      ) : (
        <section className="qa-card space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <select
              className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
              value={examId ?? ""}
              onChange={(event) => {
                const nextId = Number(event.target.value);
                setExamId(Number.isFinite(nextId) ? nextId : null);
                setQuestionFilter("all");
                setStudentFilter("all");
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
              {studentOptions.map((userName) => (
                <option key={userName} value={userName}>
                  {userName}
                </option>
              ))}
            </select>
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
            {studentFilter !== "all" ? ` | 필터 적용: ${filteredSubmissions.length}명` : ""}
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
        <p className="text-xs text-muted-foreground">객관식 문항 기준입니다. 막대에 마우스를 올리면 인원 수가 표시됩니다.</p>
        {correctCountDistribution.length === 0 ? (
          <p className="text-sm text-muted-foreground">집계할 객관식 제출 데이터가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {correctCountDistribution.map((bucket) => {
              const width = (bucket.count / maxDistributionCount) * 100;
              return (
                <div key={bucket.correctCount} className="grid grid-cols-[88px_1fr] items-center gap-3">
                  <p className="text-sm text-muted-foreground">{bucket.correctCount}개 정답</p>
                  <div className="h-8 rounded-lg bg-surface-muted px-1 py-1">
                    <div
                      className="h-full rounded-md bg-primary"
                      style={{ width: `${Math.max(4, width)}%` }}
                      title={`${bucket.count}명`}
                      aria-label={`${bucket.correctCount}개 정답 인원 ${bucket.count}명`}
                    />
                  </div>
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
                    .map((answer) => (
                      <div key={`${submission.submission_id}-${answer.question_id}`} className="rounded-lg bg-surface-muted p-2 text-xs">
                        <p>
                          {answer.question_order}. {answer.prompt_md}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {answer.question_type === "multiple_choice"
                            ? `선택: ${answer.selected_choice_index === null ? "-" : `${answer.selected_choice_index + 1}번`}`
                            : `답안: ${answer.answer_text ?? "-"}`}
                        </p>
                        {answer.question_type === "multiple_choice" && answer.correct_choice_index !== null ? (
                          <p className="mt-1 text-muted-foreground">
                            정답: {answer.correct_choice_index + 1}번{" "}
                            {answer.selected_choice_index === answer.correct_choice_index ? "(정답)" : "(오답)"}
                          </p>
                        ) : null}
                        {answer.question_type === "coding" ? (
                          <p className="mt-1 text-muted-foreground">
                            자동채점: {answer.grading_status ?? "미실행"}
                            {answer.grading_score !== null && answer.grading_max_score !== null
                              ? ` (${answer.grading_score}/${answer.grading_max_score})`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                    ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
