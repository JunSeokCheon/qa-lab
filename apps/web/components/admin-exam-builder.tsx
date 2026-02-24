"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { MarkdownContent } from "@/components/markdown-content";
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
  [TEMPLATE_PANDAS_HEAD]: "CSV 읽기/5행 출력",
  [TEMPLATE_FUNCTION_IO]: "함수 구현",
  [TEMPLATE_VISUAL_STATS]: "시각화/통계",
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
    '- `pd.read_csv("test.csv")`로 파일을 읽는가',
    "- `head()` 결과를 출력하는가",
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
    "- 통계 요약 출력",
    "- 시각화 코드 포함",
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
  const answerPreview =
    question.answerKeyText.trim() || "(정답/채점 기준을 먼저 간단히 작성해 주세요)";
  if (question.type === "coding") {
    return [
      "",
      "## 채점기준 도우미 초안",
      `문항 요약: ${question.prompt_md.trim()}`,
      "",
      "[필수 체크포인트]",
      "- 입력 데이터/파일 접근 방식이 문제 요구와 일치하는가",
      "- 요구된 함수/메서드를 올바르게 사용했는가",
      "- 결과 출력 또는 반환 형식이 문제 요구와 일치하는가",
      "",
      "[정답/오답 기준 예시]",
      "- 필수 요구사항을 모두 만족하면 정답",
      "- 필수 요구사항이 누락되면 오답",
      "",
      "[정답 기준 요약]",
      answerPreview,
    ].join("\n");
  }

  return [
    "",
    "## 채점기준 도우미 초안",
    `문항 요약: ${question.prompt_md.trim()}`,
    "",
    "[필수 체크포인트]",
    "- 핵심 개념을 정확히 설명했는가",
    "- 문제에서 요구한 근거가 포함되었는가",
    "",
    "[정답/오답 기준 예시]",
    "- 정답 기준과 일치하면 정답",
    "- 핵심 개념/근거가 누락되면 오답",
    "",
    "[정답 기준 요약]",
    answerPreview,
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
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [answerKeyEditor, setAnswerKeyEditor] = useState<{
    questionKey: number;
    questionLabel: string;
    value: string;
  } | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState(initialFolders[0] ? String(initialFolders[0].id) : "");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [targetTrackName, setTargetTrackName] = useState<string>(TRACK_OPTIONS[0]);
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [noTimeLimit, setNoTimeLimit] = useState(false);
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

  useEffect(() => {
    if (!answerKeyEditor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAnswerKeyEditor(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answerKeyEditor]);

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
    setMessage(`肄붾뵫 ?뺣떟 ?쒗뵆由우쓣 ?곸슜?덉뒿?덈떎: ${CODING_TEMPLATE_LABEL[templateKey]}`);
    setError("");
  };

  const appendRubricHelper = (question: DraftQuestion) => {
    if (!question.prompt_md.trim()) {
      setError("梨꾩젏湲곗? ?꾩슦誘몃? ?ъ슜?섎젮硫?癒쇱? 臾명빆 ?댁슜???낅젰??二쇱꽭??");
      setMessage("");
      return;
    }
    const helper = buildRubricHelperText(question);
    const next = question.answerKeyText.trim() ? `${question.answerKeyText.trim()}\n${helper}` : helper.trim();
    updateQuestion(question.key, { answerKeyText: next });
    setMessage(`臾명빆 ${questions.findIndex((item) => item.key === question.key) + 1}??梨꾩젏湲곗? 珥덉븞??異붽??덉뒿?덈떎.`);
    setError("");
  };

  const openAnswerKeyEditor = (question: DraftQuestion, questionIndex: number) => {
    setAnswerKeyEditor({
      questionKey: question.key,
      questionLabel: `${questionIndex + 1}踰?臾명빆`,
      value: question.answerKeyText,
    });
  };

  const saveAnswerKeyEditor = () => {
    if (!answerKeyEditor) return;
    updateQuestion(answerKeyEditor.questionKey, { answerKeyText: answerKeyEditor.value });
    setAnswerKeyEditor(null);
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

  const createExam = async () => {
    if (loading || uploadingResources) return;
    setShowCreateConfirm(false);
    setError("");
    setMessage("");
    setLoading(true);

    if (!title.trim()) {
      setError("?쒗뿕 ?쒕ぉ???낅젰??二쇱꽭??");
      setLoading(false);
      return;
    }
    if (!targetTrackName) {
      setError("?묒떆 ???諛섏쓣 ?좏깮??二쇱꽭??");
      setLoading(false);
      return;
    }
    let parsedDuration: number | null = null;
    if (!noTimeLimit) {
      parsedDuration = Number.parseInt(durationMinutes.trim(), 10);
      if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 1440) {
        setError("?쒗뿕 ?쒓컙? 1遺??댁긽 1440遺??댄븯濡??낅젰??二쇱꽭??");
        setLoading(false);
        return;
      }
    }

    const normalizedQuestions = [];
    for (const question of questions) {
      if (!question.prompt_md.trim()) {
        setError("紐⑤뱺 臾명빆 ?댁슜???낅젰??二쇱꽭??");
        setLoading(false);
        return;
      }
      if (question.type === "multiple_choice") {
        const trimmedChoices = question.choices.map((choice) => choice.trim());
        if (trimmedChoices.some((choice) => choice.length === 0)) {
          setError("媛앷??앹? ?좏깮吏 4媛쒕? 紐⑤몢 ?낅젰??二쇱꽭??");
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
        duration_minutes: parsedDuration,
        status: "published",
        questions: normalizedQuestions,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "?쒗뿕 ?앹꽦???ㅽ뙣?덉뒿?덈떎.");
      setLoading(false);
      return;
    }

    const uploadResult = await uploadResourceFilesToExam(payload.id, resourceFiles);
    if (uploadResult.failed.length > 0) {
      setError(`?쒗뿕? ?앹꽦?섏뿀吏留?由ъ냼???낅줈?쒖뿉 ?ㅽ뙣???뚯씪???덉뒿?덈떎: ${uploadResult.failed.join(", ")}`);
    }

    const uploadMessage = uploadResult.uploaded > 0 ? `, 由ъ냼??${uploadResult.uploaded}媛??낅줈???꾨즺` : "";
    setMessage(`?쒗뿕???앹꽦?덉뒿?덈떎. (ID: ${payload.id}${uploadMessage})`);
    setTitle("");
    setDescription("");
    setTargetTrackName(TRACK_OPTIONS[0]);
    setDurationMinutes("60");
    setNoTimeLimit(false);
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
        <p className="qa-kicker mt-4 text-hero-foreground/80">愿由ъ옄</p>
        <h1 className="mt-2 text-3xl font-bold">시험지 관리</h1>
        <p className="mt-3 text-sm text-hero-foreground/90">
          臾명빆蹂??뺣떟/梨꾩젏湲곗????낅젰?섎㈃ ?먮룞 梨꾩젏(媛앷???湲곗? 梨꾩젏 + 二쇨???肄붾뵫 LLM 梨꾩젏)???쒖슜?⑸땲??
        </p>
        <p className="mt-2 text-xs text-hero-foreground/90">
          肄붾뱶 釉붾줉 ?묒꽦: 臾명빆/?ㅻ챸??<code>```python</code>?쇰줈 ?쒖옉?섍퀬 <code>```</code>?쇰줈 ?レ쑝硫?誘몃━蹂닿린? ?묒떆 ?붾㈃??肄붾뱶 釉붾줉?쇰줈 ?쒖떆?⑸땲??
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <section className="qa-card">
        <details open className="space-y-2">
          <summary className="cursor-pointer text-sm font-semibold">?쒗꽣??臾몄젣-?뺣떟 ?묒꽦 媛?대뱶</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>媛앷??? ?뺣떟 ?쇰뵒??踰꾪듉留??뺥솗???좏깮?섎㈃ ?⑸땲??</li>
            <li>二쇨??? ?뺣떟 ?ㅼ썙?쒖? ?꾩닔 ?ы븿 ?댁슜(?? ?⑹뼱, 洹쇨굅)??吏㏐쾶 ?곸뼱二쇱꽭??</li>
            <li>肄붾뵫: ?뺣떟 肄붾뱶 ?덉떆 + 泥댄겕?ъ씤???좏깮)???곸뼱二쇱꽭??</li>
            <li>
              코드 블록: <code>```python</code>으로 시작하고 마지막 줄에 <code>```</code>을 입력하세요.
            </li>
            <li>肄붾뵫 由ъ냼???뚯씪紐낆? ?곗씠???뱀? ?ㅼ뒿 ?뚯씪???낅줈?쒗빐???⑸땲??</li>
            <li>梨꾩젏湲곗? ?꾩슦誘?踰꾪듉?쇰줈 珥덉븞??留뚮뱺 ?? ?ㅼ젣 ?섏뾽 湲곗???留욊쾶 ?섏젙?섎㈃ ?⑸땲?? ?대떦 ?댁슜? ?좏깮?낅땲??</li>
          </ul>
        </details>
      </section>

      <form
        className="qa-card space-y-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (loading || uploadingResources) return;
          setShowCreateConfirm(true);
        }}
      >
        <h2 className="text-lg font-semibold">새 시험 만들기</h2>
        <Input placeholder="?쒗뿕 ?쒕ぉ" value={title} onChange={(event) => setTitle(event.target.value)} required />
        <Textarea
          className="min-h-24"
          placeholder="?쒗뿕 ?ㅻ챸 (?좏깮)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <select
            className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
          >
            <option value="">移댄뀒怨좊━ ?좏깮 (?좏깮)</option>
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
            <option value="quiz">?댁쫰</option>
            <option value="assessment">?깆랬???됯?</option>
          </select>
        </div>

        <select
          className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
          value={targetTrackName}
          onChange={(event) => setTargetTrackName(event.target.value)}
        >
          {TRACK_OPTIONS.map((track) => (
            <option key={track} value={track}>
              ?묒떆 ??? {track}
            </option>
          ))}
        </select>

        <div className="space-y-2 rounded-xl border border-border/70 bg-surface-muted p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">?쒗뿕 ?쒓컙 (遺?</p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={noTimeLimit}
                onChange={(event) => setNoTimeLimit(event.target.checked)}
              />
              ?쒓컙 ?쒗븳 ?놁쓬
            </label>
          </div>
          <Input
            type="number"
            min={1}
            max={1440}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            placeholder="?? 60"
            disabled={noTimeLimit}
          />
        </div>

        <div className="space-y-3">
          {questions.map((question, index) => (
            <article key={question.key} className="rounded-2xl border border-border/70 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">臾명빆 {index + 1}</h3>
                <Button type="button" variant="outline" onClick={() => removeQuestion(question.key)}>
                  臾명빆 ??젣
                </Button>
              </div>

              <select
                className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
                value={question.type}
                onChange={(event) => updateQuestion(question.key, { type: event.target.value as QuestionType })}
              >
                <option value="multiple_choice">객관식</option>
                <option value="subjective">주관식</option>
                <option value="coding">肄붾뵫</option>
              </select>

              <Textarea
                className="mt-2 min-h-48"
                placeholder="臾명빆 ?댁슜???낅젰??二쇱꽭??"
                value={question.prompt_md}
                onChange={(event) => updateQuestion(question.key, { prompt_md: event.target.value })}
                required
              />
              <div className="mt-2 rounded-xl border border-border/70 bg-background/70 p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">臾명빆 誘몃━蹂닿린</p>
                <MarkdownContent className="mt-2" content={question.prompt_md} />
              </div>

              <div className="mt-3 rounded-xl border border-border/70 bg-surface-muted p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold">?뺣떟/梨꾩젏 湲곗?</p>
                  {question.type !== "multiple_choice" ? (
                    <Button type="button" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => appendRubricHelper(question)}>
                      梨꾩젏湲곗? ?꾩슦誘?異붽?
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
                          placeholder={`${choiceIndex + 1}踰??좏깮吏`}
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
                            ?쒗뵆由? {CODING_TEMPLATE_LABEL[templateKey]}
                          </Button>
                        ))}
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-border/70 bg-background/80 p-2">
                      <p className="text-[11px] font-medium text-muted-foreground">현재 정답/채점 기준</p>
                      <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 text-xs">
                        {question.answerKeyText?.trim() ? question.answerKeyText : "(아직 입력되지 않았습니다)"}
                      </pre>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 px-3 text-xs"
                      onClick={() => openAnswerKeyEditor(question, index)}
                    >
                      큰 화면에서 정답/채점 기준 입력
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {question.type === "subjective"
                        ? "주관식은 정답/채점 기준을 입력하면 LLM이 제출 답안을 비교해 자동채점합니다."
                        : "코딩은 정답 코드/채점 기준을 입력하면 LLM이 제출 코드를 비교해 자동채점합니다."}
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
                ?꾩닔 臾명빆
              </label>
            </article>
          ))}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => addQuestion("multiple_choice")}>
              媛앷???異붽?
            </Button>
            <Button type="button" variant="outline" onClick={() => addQuestion("subjective")}>
              二쇨???異붽?
            </Button>
            <Button type="button" variant="outline" onClick={() => addQuestion("coding")}>
              肄붾뵫 異붽?
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-surface p-4">
          <p className="text-sm font-semibold">데이터 및 실습 리소스 업로드</p>
          <p className="mt-1 text-xs text-muted-foreground">
            ?щ윭 ?뚯씪 ?좏깮 媛?? zip 諛??곗씠???뚯씪(csv/xlsx/json ?????낅줈?쒗븷 ???덉뒿?덈떎.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            ?뚯씪??理쒕? 500MB源뚯? ?덉슜?⑸땲?? 珥덇낵 ??Google Drive 留곹겕瑜??쒗뿕 ?ㅻ챸/臾명빆??泥⑤???二쇱꽭??
          </p>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onResourceFileChange} />
          <div className="mt-3">
            <Button type="button" variant="outline" className="border-2" onClick={() => fileInputRef.current?.click()}>
              ?뚯씪 ?좏깮
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            ?좏깮 ?뚯씪: {resourceFiles.length > 0 ? resourceFiles.map((file) => file.name).join(", ") : "(?놁쓬)"}
          </p>
          {!hasCodingQuestion && resourceFiles.length > 0 ? (
            <p className="mt-1 text-xs text-amber-700">?꾩옱 肄붾뵫 臾명빆???놁?留?由ъ냼?ㅻ뒗 ?④퍡 ??λ맗?덈떎.</p>
          ) : null}
        </div>

        <Button disabled={loading || uploadingResources}>{loading || uploadingResources ? "?앹꽦 以?.." : "?쒗뿕 ?앹꽦"}</Button>
      </form>

      {answerKeyEditor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-5xl rounded-2xl border border-border/70 bg-card p-5 shadow-xl">
            <h3 className="text-lg font-semibold">{answerKeyEditor.questionLabel} 정답/채점 기준 입력</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              길이가 긴 주관식/코딩 정답은 큰 입력창에서 작성한 뒤 저장하세요.
            </p>
            <Textarea
              className="mt-3 min-h-[55vh] text-xs leading-6"
              value={answerKeyEditor.value}
              onChange={(event) =>
                setAnswerKeyEditor((prev) => (prev ? { ...prev, value: event.target.value } : prev))
              }
              placeholder="정답/채점 기준을 입력하세요."
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAnswerKeyEditor(null)}>
                취소
              </Button>
              <Button type="button" onClick={saveAnswerKeyEditor}>
                저장
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-primary/40 bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-primary to-[#d80028] px-5 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">?뺤씤</p>
              <h3 className="mt-1 text-lg font-bold">?쒗뿕 ?앹꽦 ?뺤씤</h3>
            </div>
            <div className="space-y-3 p-5 text-sm text-foreground">
              <p className="rounded-xl border border-primary/20 bg-secondary/50 p-3">
                <span className="font-semibold">{title.trim() || "(?쒕ぉ ?놁쓬)"}</span>
              </p>
              <p>?쒗뿕???앹꽦?섏떆寃좎뒿?덇퉴?</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateConfirm(false)}
                disabled={loading || uploadingResources}
              >
                痍⑥냼
              </Button>
              <Button type="button" onClick={() => void createExam()} disabled={loading || uploadingResources}>
                {loading || uploadingResources ? "?앹꽦 以?.." : "?앹꽦"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
