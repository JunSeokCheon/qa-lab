"use client";

import { useEffect, useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";

type ExamSummary = {
  id: number;
  title: string;
  exam_kind: string;
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
  grading_feedback_json: Record<string, unknown> | null;
  grading_logs: string | null;
  graded_at: string | null;
};

type ExamSubmission = {
  submission_id: number;
  exam_id: number;
  exam_title: string;
  user_id: number;
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

export function AdminExamDashboard({ initialExams }: { initialExams: ExamSummary[] }) {
  const [exams] = useState(initialExams);
  const [examId, setExamId] = useState<number | null>(initialExams[0]?.id ?? null);
  const [submissions, setSubmissions] = useState<ExamSubmission[]>([]);
  const [questionFilter, setQuestionFilter] = useState<string>("all");
  const [studentFilter, setStudentFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (examId === null) {
      setSubmissions([]);
      return;
    }

    setLoading(true);
    setError("");
    void (async () => {
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
        if (selected === null || selected < 0 || selected >= stat.choices.length) {
          stat.unansweredUsers.push(row.username);
          continue;
        }
        stat.counts[selected] += 1;
        stat.respondents[selected].push(row.username);
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
    const names = new Set(submissions.map((row) => row.username));
    return [...names].sort((a, b) => a.localeCompare(b, "ko"));
  }, [submissions]);

  const filteredQuestionStats = useMemo(() => {
    if (questionFilter === "all") return questionStats;
    const questionId = Number(questionFilter);
    return questionStats.filter((item) => item.questionId === questionId);
  }, [questionFilter, questionStats]);

  const filteredSubmissions = useMemo(() => {
    if (studentFilter === "all") return submissions;
    return submissions.filter((row) => row.username === studentFilter);
  }, [studentFilter, submissions]);

  const correctCountDistribution = useMemo(() => {
    const targetQuestionIds = new Set(
      (questionFilter === "all" ? questionStats : filteredQuestionStats).map((item) => item.questionId)
    );
    const buckets = new Map<string, { count: number; usernames: string[] }>();

    for (const row of filteredSubmissions) {
      let total = 0;
      let correct = 0;
      for (const answer of row.answers) {
        if (answer.question_type !== "multiple_choice") continue;
        if (!targetQuestionIds.has(answer.question_id)) continue;
        if (answer.correct_choice_index === null) continue;
        total += 1;
        if (answer.selected_choice_index === answer.correct_choice_index) {
          correct += 1;
        }
      }
      const key = `${correct}/${total}`;
      const current = buckets.get(key);
      if (!current) {
        buckets.set(key, { count: 1, usernames: [row.username] });
      } else {
        current.count += 1;
        current.usernames.push(row.username);
      }
    }

    return [...buckets.entries()]
      .map(([label, value]) => ({ label, count: value.count, usernames: value.usernames }))
      .sort((a, b) => {
        const [aCorrect] = a.label.split("/").map((item) => Number(item));
        const [bCorrect] = b.label.split("/").map((item) => Number(item));
        return bCorrect - aCorrect;
      });
  }, [filteredQuestionStats, filteredSubmissions, questionFilter, questionStats]);

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/" />
        <p className="qa-kicker mt-4">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험 대시보드</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          시험별 제출 현황, 문제 통계, 학생별 상세 제출을 확인합니다.
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
                  #{exam.id} {exam.title} ({examKindLabel(exam.exam_kind)})
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
              {studentOptions.map((username) => (
                <option key={username} value={username}>
                  {username}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            응시자 수: {submissions.length}명
            {studentFilter !== "all" ? ` | 필터 적용: ${filteredSubmissions.length}명` : ""}
          </p>
          {loading ? <p className="text-sm text-muted-foreground">불러오는 중...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </section>
      )}

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">맞힌 개수별 인원수 (객관식 기준)</h2>
        {correctCountDistribution.length === 0 ? (
          <p className="text-sm text-muted-foreground">표시할 데이터가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {correctCountDistribution.map((bucket) => (
              <article key={bucket.label} className="rounded-xl border border-border/70 bg-surface p-3 text-sm">
                <p className="font-semibold">{bucket.label} 정답</p>
                <p className="text-xs text-muted-foreground">
                  {bucket.count}명 ({bucket.usernames.join(", ")})
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="qa-card space-y-3">
        <h2 className="text-lg font-semibold">문항별 통계</h2>
        {filteredQuestionStats.length === 0 ? (
          <p className="text-sm text-muted-foreground">객관식 응답이 없습니다.</p>
        ) : (
          <div className="space-y-3">
            {filteredQuestionStats.map((stat) => (
              <article key={stat.questionId} className="rounded-xl border border-border/70 bg-surface p-3">
                <p className="text-sm font-semibold">
                  {stat.questionOrder}. {stat.prompt}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">총 응답 수: {stat.totalResponses}</p>
                <div className="mt-2 space-y-2">
                  {stat.choices.map((choice, index) => (
                    <div key={`${stat.questionId}-${index}`} className="rounded-lg bg-surface-muted p-2 text-xs">
                      <p>
                        {index + 1}번: {choice}
                        {stat.correctChoiceIndex === index ? " (정답)" : ""}
                      </p>
                      <p className="mt-1 text-muted-foreground">응답자 수: {stat.counts[index]}명</p>
                      <p className="mt-1 text-muted-foreground">
                        응답 학생: {stat.respondents[index].length ? stat.respondents[index].join(", ") : "-"}
                      </p>
                    </div>
                  ))}
                  {stat.unansweredUsers.length > 0 ? (
                    <p className="rounded-lg bg-surface-muted p-2 text-xs text-muted-foreground">
                      미응답 학생: {stat.unansweredUsers.join(", ")}
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
                  {submission.username} ({new Date(submission.submitted_at).toLocaleString()})
                </p>
                <div className="mt-2 space-y-2">
                  {submission.answers
                    .filter((answer) =>
                      questionFilter === "all" ? true : answer.question_id === Number(questionFilter)
                    )
                    .map((answer) => (
                      <div key={`${submission.submission_id}-${answer.question_id}`} className="rounded-lg bg-surface-muted p-2 text-xs">
                        <p>
                          {answer.question_order}. {answer.prompt_md}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {answer.question_type === "multiple_choice"
                            ? `선택: ${answer.selected_choice_index === null ? "-" : `${answer.selected_choice_index + 1}번`}`
                            : `답변: ${answer.answer_text ?? "-"}`}
                        </p>
                        {answer.question_type === "multiple_choice" && answer.correct_choice_index !== null ? (
                          <p className="mt-1 text-muted-foreground">
                            정답: {answer.correct_choice_index + 1}번{" "}
                            {answer.selected_choice_index === answer.correct_choice_index ? "(정답)" : "(오답)"}
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
