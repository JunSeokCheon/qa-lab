"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Folder = { id: number; path: string };

type QuestionType = "multiple_choice" | "subjective" | "coding";
type DraftQuestion = {
  key: number;
  type: QuestionType;
  prompt_md: string;
  required: boolean;
  choices: string[];
  correctChoiceIndex: number;
  answerKeyText: string;
};

const TRACK_OPTIONS = ["데이터 분석 11기", "QAQC 4기"] as const;
const TEMPLATE_PANDAS_HEAD = "pandas_head";
const TEMPLATE_FUNCTION_IO = "function_io";
const TEMPLATE_VISUAL_STATS = "visual_stats";
type CodingTemplateKey = typeof TEMPLATE_PANDAS_HEAD | typeof TEMPLATE_FUNCTION_IO | typeof TEMPLATE_VISUAL_STATS;

const CODING_TEMPLATE_LABEL: Record<CodingTemplateKey, string> = {
  [TEMPLATE_PANDAS_HEAD]: "CSV 읽기/5행",
  [TEMPLATE_FUNCTION_IO]: "함수 구현형",
  [TEMPLATE_VISUAL_STATS]: "시각화/통계형",
};

const CODING_TEMPLATE_TEXT: Record<CodingTemplateKey, string> = {
  [TEMPLATE_PANDAS_HEAD]: [
    "## 정답 코드 예시",
    "```python",
    "import pandas as pd",
    "",
    'df = pd.read_csv("test.csv")',
    "print(df.head())",
    "```",
    "",
    "## 채점 체크포인트",
    "- pandas import가 있는가",
    '- `pd.read_csv(\"test.csv\")`로 파일을 읽는가',
    "- `head()` 결과를 출력하는가",
    "",
    "## 부분 점수 기준",
    "- 파일 읽기만 성공: 60점",
    "- 파일 읽기 + head 출력: 100점",
    "",
    "## 오답 처리",
    "- 파일명 오류, 함수 미사용, 출력 누락 시 감점",
  ].join("\n"),
  [TEMPLATE_FUNCTION_IO]: [
    "## 정답 코드 예시",
    "```python",
    "def solve(a, b):",
    "    return a + b",
    "```",
    "",
    "## 채점 체크포인트",
    "- 함수명/인자 시그니처가 요구사항과 일치하는가",
    "- 반환값 로직이 문제 요구를 만족하는가",
    "- 기본/경계 입력에서 오동작이 없는가",
    "",
    "## 부분 점수 기준",
    "- 함수 시그니처만 맞음: 40점",
    "- 핵심 로직 일부 구현: 70점",
    "- 요구사항 완전 충족: 100점",
    "",
    "## 오답 처리",
    "- print만 하고 return이 없는 경우 감점",
  ].join("\n"),
  [TEMPLATE_VISUAL_STATS]: [
    "## 정답 코드 예시",
    "```python",
    "import pandas as pd",
    "import matplotlib.pyplot as plt",
    "",
    'df = pd.read_csv("test.csv")',
    'summary = df.describe(include="all")',
    "print(summary)",
    "df.hist(figsize=(10, 6))",
    "plt.tight_layout()",
    "plt.show()",
    "```",
    "",
    "## 채점 체크포인트",
    "- 데이터 로드 성공",
    "- 통계 요약 결과 출력",
    "- 시각화 코드(그래프 생성/표시) 포함",
    "",
    "## 부분 점수 기준",
    "- 로드 + 통계: 70점",
    "- 로드 + 통계 + 시각화: 100점",
    "",
    "## 오답 처리",
    "- 시각화 누락 또는 통계 함수 미사용 시 감점",
  ].join("\n"),
};

function newQuestion(key: number, type: QuestionType): DraftQuestion {
  return {
    key,
    type,
    prompt_md: "",
    required: true,
    choices: ["", "", "", ""],
    correctChoiceIndex: 0,
    answerKeyText: "",
  };
}

function buildRubricHelperText(question: DraftQuestion): string {
  const answerPreview = question.answerKeyText.trim() || "(정답/채점 기준을 먼저 간단히 작성해 주세요)";
  if (question.type === "coding") {
    return [
      "",
      "## 채점기준 도우미 초안",
      `문항 요약: ${question.prompt_md.trim()}`,
      "",
      "[필수 체크포인트]",
      "- 입력 데이터/파일 접근 방식이 맞는가",
      "- 핵심 함수/메서드를 올바르게 사용했는가",
      "- 결과 출력 또는 반환 형식이 맞는가",
      "- 예외/경계값 처리 관점에서 치명적 오류가 없는가",
      "",
      "[부분 점수 기준(예시)]",
      "- 핵심 로직 일부 구현: 40~70점",
      "- 동작은 하나 정답 기준과 차이 있음: 70~90점",
      "- 정답 기준 충족: 100점",
      "",
      "[정답 기준 요약]",
      answerPreview,
      "",
      "[오답 사유 예시]",
      "- 파일 경로/파일명 오류",
      "- 요구한 함수 미사용",
      "- 출력/반환 누락",
    ].join("\n");
  }

  return [
    "",
    "## 채점기준 도우미 초안",
    `문항 요약: ${question.prompt_md.trim()}`,
    "",
    "[핵심 체크포인트]",
    "- 핵심 개념을 정확히 설명했는가",
    "- 문제에서 요구한 키워드/근거가 포함되었는가",
    "- 답변 구조가 논리적인가",
    "",
    "[부분 점수 기준(예시)]",
    "- 핵심 개념 일부 언급: 40~70점",
    "- 핵심은 맞지만 근거 부족: 70~90점",
    "- 개념/근거 모두 충족: 100점",
    "",
    "[정답 기준 요약]",
    answerPreview,
    "",
    "[오답 사유 예시]",
    "- 핵심 개념 누락",
    "- 질문과 무관한 답변",
    "- 근거 부족",
  ].join("\n");
}

export function AdminExamBuilder({
  initialFolders,
}: {
  initialFolders: Folder[];
}) {
  const [folders, setFolders] = useState(initialFolders);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingResources, setUploadingResources] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState(initialFolders[0] ? String(initialFolders[0].id) : "");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [targetTrackName, setTargetTrackName] = useState<string>(TRACK_OPTIONS[0]);
  const [questions, setQuestions] = useState<DraftQuestion[]>([newQuestion(1, "multiple_choice")]);
  const [resourceFiles, setResourceFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (folders.length > 0) return;
    void (async () => {
      const response = await fetch("/api/admin/problem-folders", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => [])) as Folder[];
      if (payload.length === 0) return;
      setFolders(payload);
      setFolderId(String(payload[0].id));
    })();
  }, [folders.length]);

  const hasCodingQuestion = useMemo(() => questions.some((question) => question.type === "coding"), [questions]);

  const updateQuestion = (key: number, patch: Partial<DraftQuestion>) => {
    setQuestions((prev) => prev.map((question) => (question.key === key ? { ...question, ...patch } : question)));
  };

  const updateChoice = (key: number, choiceIndex: number, value: string) => {
    setQuestions((prev) =>
      prev.map((question) => {
        if (question.key !== key) return question;
        const nextChoices = [...question.choices];
        nextChoices[choiceIndex] = value;
        return { ...question, choices: nextChoices };
      })
    );
  };

  const applyCodingTemplate = (questionKey: number, templateKey: CodingTemplateKey) => {
    const template = CODING_TEMPLATE_TEXT[templateKey];
    updateQuestion(questionKey, { answerKeyText: template });
    setMessage(`코딩 정답 템플릿을 적용했습니다: ${CODING_TEMPLATE_LABEL[templateKey]}`);
    setError("");
  };

  const appendRubricHelper = (question: DraftQuestion) => {
    if (!question.prompt_md.trim()) {
      setError("채점기준 도우미를 사용하려면 먼저 문항 내용을 입력해 주세요.");
      setMessage("");
      return;
    }
    const helper = buildRubricHelperText(question);
    const next = question.answerKeyText.trim() ? `${question.answerKeyText.trim()}\n${helper}` : helper.trim();
    updateQuestion(question.key, { answerKeyText: next });
    setMessage(`문항 ${questions.findIndex((item) => item.key === question.key) + 1}에 채점기준 초안을 추가했습니다.`);
    setError("");
  };

  const addQuestion = (type: QuestionType) => {
    setQuestions((prev) => [...prev, newQuestion(Date.now() + Math.floor(Math.random() * 1000), type)]);
  };

  const removeQuestion = (key: number) => {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((question) => question.key !== key) : prev));
  };

  const uploadResourceFilesToExam = async (examId: number, files: File[]) => {
    if (files.length === 0) {
      return { uploaded: 0, failed: [] as string[] };
    }

    setUploadingResources(true);
    const failed: string[] = [];
    let uploaded = 0;
    try {
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append("file", file, file.name);
          const response = await fetch(`/api/admin/exams/${examId}/resources`, {
            method: "POST",
            body: formData,
          });
          if (!response.ok) {
            failed.push(file.name);
            continue;
          }
          uploaded += 1;
        } catch {
          failed.push(file.name);
        }
      }
      return { uploaded, failed };
    } finally {
      setUploadingResources(false);
    }
  };

  const onResourceFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = event.target.files ? Array.from(event.target.files) : [];
    setResourceFiles(nextFiles);
  };

  const onCreateExam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    if (!title.trim()) {
      setError("시험 제목을 입력해 주세요.");
      setLoading(false);
      return;
    }
    if (!targetTrackName) {
      setError("응시 대상 반을 선택해 주세요.");
      setLoading(false);
      return;
    }

    const normalizedQuestions = [];
    for (const question of questions) {
      if (!question.prompt_md.trim()) {
        setError("모든 문항 내용을 입력해 주세요.");
        setLoading(false);
        return;
      }
      if (question.type === "multiple_choice") {
        const trimmedChoices = question.choices.map((choice) => choice.trim());
        if (trimmedChoices.some((choice) => choice.length === 0)) {
          setError("객관식은 선택지 4개를 모두 입력해 주세요.");
          setLoading(false);
          return;
        }
        normalizedQuestions.push({
          type: "multiple_choice",
          prompt_md: question.prompt_md.trim(),
          required: question.required,
          choices: trimmedChoices,
          correct_choice_index: question.correctChoiceIndex,
          answer_key_text: null,
        });
      } else {
        normalizedQuestions.push({
          type: question.type,
          prompt_md: question.prompt_md.trim(),
          required: question.required,
          choices: null,
          correct_choice_index: null,
          answer_key_text: question.answerKeyText.trim() || null,
        });
      }
    }

    const response = await fetch("/api/admin/exams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        folder_id: folderId ? Number(folderId) : null,
        exam_kind: examKind,
        target_track_name: targetTrackName,
        status: "published",
        questions: normalizedQuestions,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "시험 생성에 실패했습니다.");
      setLoading(false);
      return;
    }

    const uploadResult = await uploadResourceFilesToExam(payload.id, resourceFiles);
    if (uploadResult.failed.length > 0) {
      setError(`시험은 생성되었지만 리소스 업로드에 실패한 파일이 있습니다: ${uploadResult.failed.join(", ")}`);
    }

    const uploadMessage = uploadResult.uploaded > 0 ? `, 리소스 ${uploadResult.uploaded}개 업로드 완료` : "";
    setMessage(`시험을 생성했습니다. (ID: ${payload.id}${uploadMessage})`);
    setTitle("");
    setDescription("");
    setTargetTrackName(TRACK_OPTIONS[0]);
    setQuestions([newQuestion(Date.now(), "multiple_choice")]);
    setResourceFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setLoading(false);
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/" tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험지 관리</h1>
        <p className="mt-3 text-sm text-hero-foreground/90">
          문항별 정답/채점기준을 입력하면 자동 채점(객관식 기준 채점 + 주관식/코딩 LLM 채점)에 활용됩니다.
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <section className="qa-card">
        <details open className="space-y-2">
          <summary className="cursor-pointer text-sm font-semibold">비개발자 튜터용 문제-정답 작성 가이드</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>객관식: 정답 라디오 버튼만 정확히 선택하면 됩니다.</li>
            <li>주관식: 정답 키워드와 필수 포함 내용(예: 용어, 근거)을 짧게 적어주세요.</li>
            <li>코딩: 정답 코드 예시 + 체크포인트 + 부분점수 기준을 함께 적어주세요.</li>
            <li>코딩 리소스 파일명은 문제 문구와 정답 예시에 동일하게 적어주세요.</li>
            <li>채점기준 도우미 버튼으로 초안을 만든 뒤, 실제 수업 기준에 맞게 수정하면 됩니다.</li>
          </ul>
        </details>
      </section>

      <form className="qa-card space-y-4" onSubmit={onCreateExam}>
        <h2 className="text-lg font-semibold">새 시험 만들기</h2>
        <Input placeholder="시험 제목" value={title} onChange={(event) => setTitle(event.target.value)} required />
        <Textarea
          className="min-h-24"
          placeholder="시험 설명 (선택)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <select
            className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
          >
            <option value="">카테고리 선택 (선택)</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.path}
              </option>
            ))}
          </select>
          <select
            className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={examKind}
            onChange={(event) => setExamKind(event.target.value as "quiz" | "assessment")}
          >
            <option value="quiz">퀴즈</option>
            <option value="assessment">성취도 평가</option>
          </select>
        </div>

        <select
          className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
          value={targetTrackName}
          onChange={(event) => setTargetTrackName(event.target.value)}
        >
          {TRACK_OPTIONS.map((track) => (
            <option key={track} value={track}>
              응시 대상: {track}
            </option>
          ))}
        </select>

        <div className="space-y-3">
          {questions.map((question, index) => (
            <article key={question.key} className="rounded-2xl border border-border/70 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">문항 {index + 1}</h3>
                <Button type="button" variant="outline" onClick={() => removeQuestion(question.key)}>
                  문항 삭제
                </Button>
              </div>

              <select
                className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
                value={question.type}
                onChange={(event) => updateQuestion(question.key, { type: event.target.value as QuestionType })}
              >
                <option value="multiple_choice">객관식</option>
                <option value="subjective">주관식</option>
                <option value="coding">코딩</option>
              </select>

              <Textarea
                className="mt-2 min-h-24"
                placeholder="문항 내용을 입력해 주세요."
                value={question.prompt_md}
                onChange={(event) => updateQuestion(question.key, { prompt_md: event.target.value })}
                required
              />

              <div className="mt-3 rounded-xl border border-border/70 bg-surface-muted p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">정답/채점 기준</p>
                  {question.type !== "multiple_choice" ? (
                    <Button type="button" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => appendRubricHelper(question)}>
                      채점기준 도우미 추가
                    </Button>
                  ) : null}
                </div>

                {question.type === "multiple_choice" ? (
                  <div className="mt-2 space-y-2">
                    {question.choices.map((choice, choiceIndex) => (
                      <label key={`${question.key}-${choiceIndex}`} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`correct-choice-${question.key}`}
                          checked={question.correctChoiceIndex === choiceIndex}
                          onChange={() => updateQuestion(question.key, { correctChoiceIndex: choiceIndex })}
                        />
                        <span className="w-10 text-muted-foreground">{choiceIndex + 1}번</span>
                        <Input
                          placeholder={`${choiceIndex + 1}번 선택지`}
                          value={choice}
                          onChange={(event) => updateChoice(question.key, choiceIndex, event.target.value)}
                        />
                      </label>
                    ))}
                    <p className="text-xs text-muted-foreground">현재 정답: {question.correctChoiceIndex + 1}번</p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {question.type === "coding" ? (
                      <div className="flex flex-wrap gap-2">
                        {(Object.keys(CODING_TEMPLATE_LABEL) as CodingTemplateKey[]).map((templateKey) => (
                          <Button
                            key={templateKey}
                            type="button"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => applyCodingTemplate(question.key, templateKey)}
                          >
                            템플릿: {CODING_TEMPLATE_LABEL[templateKey]}
                          </Button>
                        ))}
                      </div>
                    ) : null}

                    <Textarea
                      className="min-h-28"
                      placeholder={
                        question.type === "subjective"
                          ? "주관식 정답/채점 기준을 입력해 주세요."
                          : "코딩 정답 코드 + 체크포인트 + 부분점수 기준을 입력해 주세요."
                      }
                      value={question.answerKeyText}
                      onChange={(event) => updateQuestion(question.key, { answerKeyText: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {question.type === "subjective"
                        ? "입력한 정답/채점 기준을 바탕으로 LLM이 제출 답안을 자동 평가합니다."
                        : "코딩은 템플릿 또는 직접 작성한 정답 기준으로 LLM이 기능/로직 기준으로 평가합니다."}
                    </p>
                  </div>
                )}
              </div>

              <label className="mt-3 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={question.required}
                  onChange={(event) => updateQuestion(question.key, { required: event.target.checked })}
                />
                필수 문항
              </label>
            </article>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => addQuestion("multiple_choice")}>
              객관식 추가
            </Button>
            <Button type="button" variant="outline" onClick={() => addQuestion("subjective")}>
              주관식 추가
            </Button>
            <Button type="button" variant="outline" onClick={() => addQuestion("coding")}>
              코딩 추가
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-surface p-4">
          <p className="text-sm font-semibold">코딩 문제 리소스 업로드 (시험과 함께 보관)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            여러 파일 선택 가능. zip 및 데이터 파일(csv/xlsx/json 등)을 업로드할 수 있습니다.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            파일당 최대 500MB까지 허용됩니다. 초과 시 Google Drive 링크를 시험 설명/문항에 첨부해 주세요.
          </p>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onResourceFileChange} />
          <div className="mt-3">
            <Button type="button" variant="outline" className="border-2" onClick={() => fileInputRef.current?.click()}>
              파일 선택
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            선택 파일: {resourceFiles.length > 0 ? resourceFiles.map((file) => file.name).join(", ") : "(없음)"}
          </p>
          {!hasCodingQuestion && resourceFiles.length > 0 ? (
            <p className="mt-1 text-xs text-amber-700">현재 코딩 문항이 없지만 리소스는 함께 저장됩니다.</p>
          ) : null}
        </div>

        <Button disabled={loading || uploadingResources}>{loading || uploadingResources ? "생성 중..." : "시험 생성"}</Button>
      </form>
    </main>
  );
}

