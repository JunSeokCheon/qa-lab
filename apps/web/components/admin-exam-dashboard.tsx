"use client";

import { useEffect, useMemo, useState } from "react";

import { BackButton } from "@/components/back-button";

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

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/" />
        <p className="qa-kicker mt-4">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험 대시보드</h1>
        <p className="mt-2 text-sm text-muted-foreground">
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
          <p className="text-xs text-muted-foreground">
            응시자 수: {submissions.length}명
            {studentFilter !== "all" ? ` | 필터 적용: ${filteredSubmissions.length}명` : ""}
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
