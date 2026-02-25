"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { MarkdownContent } from "@/components/markdown-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { datetimeLocalToUtcIso } from "@/lib/datetime";

type Folder = { id: number; path: string };

type QuestionType = "multiple_choice" | "subjective" | "coding";
type DraftQuestionImage = {
  id: number;
  file: File;
  previewUrl: string;
};

type DraftQuestion = {
  key: number;
  type: QuestionType;
  prompt_md: string;
  required: boolean;
  choices: string[];
  correctChoiceIndexes: number[];
  answerKeyText: string;
  imageFiles: DraftQuestionImage[];
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
    "## 정답 판정 기준",
    "- 파일 읽기 + head 출력까지 충족하면 정답",
    "- 필수 단계가 누락되면 오답",
    "",
    "## 오답 처리",
    "- 파일명 오류, 함수 미사용, 출력 누락 시 오답 처리",
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
    "## 정답 판정 기준",
    "- 함수 시그니처와 핵심 로직이 요구사항을 모두 충족하면 정답",
    "- 핵심 요구사항이 하나라도 누락되면 오답",
    "",
    "## 오답 처리",
    "- print만 하고 return이 없으면 오답 처리",
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
    "## 정답 판정 기준",
    "- 로드 + 통계 + 시각화 요구사항을 모두 충족하면 정답",
    "- 필수 출력/시각화가 누락되면 오답",
    "",
    "## 오답 처리",
    "- 시각화 누락 또는 통계 함수 미사용 시 오답 처리",
  ].join("\n"),
};

function newQuestion(key: number, type: QuestionType): DraftQuestion {
  return {
    key,
    type,
    prompt_md: "",
    required: true,
    choices: ["", "", "", ""],
    correctChoiceIndexes: [0],
    answerKeyText: "",
    imageFiles: [],
  };
}

function normalizeChoiceIndexes(rawIndexes: number[] | undefined | null): number[] {
  if (!Array.isArray(rawIndexes)) return [];
  const deduped = Array.from(new Set(rawIndexes.filter((value) => Number.isInteger(value))));
  return deduped.sort((a, b) => a - b);
}

function formatChoiceIndexesLabel(rawIndexes: number[] | undefined | null): string {
  const indexes = normalizeChoiceIndexes(rawIndexes);
  if (indexes.length === 0) return "선택 없음";
  return indexes.map((index) => `${index + 1}번`).join(", ");
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
      "[정답/오답 기준(예시)]",
      "- 필수 요구사항(입력 처리/핵심 로직/출력 형식)을 모두 충족하면 정답",
      "- 필수 요구사항 중 하나라도 누락되면 오답",
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
    "[정답/오답 기준(예시)]",
    "- 핵심 개념과 결론이 정답 기준과 일치하면 정답",
    "- 핵심 개념 또는 결론이 누락되면 오답",
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
  const router = useRouter();
  const [existingExamTitles, setExistingExamTitles] = useState<string[]>([]);
  const [folders, setFolders] = useState(initialFolders);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingResources, setUploadingResources] = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [folderId, setFolderId] = useState(initialFolders[0] ? String(initialFolders[0].id) : "");
  const [examKind, setExamKind] = useState<"quiz" | "assessment">("quiz");
  const [targetTrackName, setTargetTrackName] = useState<string>(TRACK_OPTIONS[0]);
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [noTimeLimit, setNoTimeLimit] = useState(false);
  const [questions, setQuestions] = useState<DraftQuestion[]>([newQuestion(1, "multiple_choice")]);
  const [resourceFiles, setResourceFiles] = useState<File[]>([]);
  const [answerKeyModalQuestionKey, setAnswerKeyModalQuestionKey] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const questionImageInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const pageTopRef = useRef<HTMLDivElement | null>(null);
  const questionsRef = useRef<DraftQuestion[]>(questions);

  const scrollToPageTop = () => {
    window.requestAnimationFrame(() => {
      pageTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const setCreateError = (nextError: string) => {
    setError(nextError);
    scrollToPageTop();
  };

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
    void (async () => {
      const response = await fetch("/api/admin/exams", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => [])) as { title?: string }[];
      const titles = payload
        .map((exam) => (exam.title ?? "").trim().toLowerCase())
        .filter((title) => title.length > 0);
      setExistingExamTitles(titles);
    })();
  }, []);

  const hasCodingQuestion = useMemo(() => questions.some((question) => question.type === "coding"), [questions]);
  const answerKeyModalQuestion = questions.find((question) => question.key === answerKeyModalQuestionKey) ?? null;
  const answerKeyModalOrder =
    answerKeyModalQuestion !== null ? questions.findIndex((question) => question.key === answerKeyModalQuestion.key) + 1 : null;

  useEffect(() => {
    if (answerKeyModalQuestionKey === null) return;
    if (questions.some((question) => question.key === answerKeyModalQuestionKey)) return;
    setAnswerKeyModalQuestionKey(null);
  }, [questions, answerKeyModalQuestionKey]);

  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);

  useEffect(() => {
    return () => {
      for (const question of questionsRef.current) {
        releaseQuestionImages(question.imageFiles);
      }
    };
  }, []);

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

  const toggleCorrectChoice = (key: number, choiceIndex: number) => {
    setQuestions((prev) =>
      prev.map((question) => {
        if (question.key !== key) return question;
        const current = normalizeChoiceIndexes(question.correctChoiceIndexes);
        const next = current.includes(choiceIndex)
          ? current.filter((value) => value !== choiceIndex)
          : normalizeChoiceIndexes([...current, choiceIndex]);
        return { ...question, correctChoiceIndexes: next };
      })
    );
  };

  const releaseQuestionImages = (images: DraftQuestionImage[]) => {
    for (const image of images) {
      URL.revokeObjectURL(image.previewUrl);
    }
  };

  const appendQuestionImages = (questionKey: number, files: File[]) => {
    if (files.length === 0) return;
    const imageItems: DraftQuestionImage[] = files.map((file, index) => ({
      id: Date.now() + index + Math.floor(Math.random() * 1000),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setQuestions((prev) =>
      prev.map((question) =>
        question.key === questionKey ? { ...question, imageFiles: [...question.imageFiles, ...imageItems] } : question
      )
    );
  };

  const removeQuestionImage = (questionKey: number, imageId: number) => {
    setQuestions((prev) =>
      prev.map((question) => {
        if (question.key !== questionKey) return question;
        const imageToRemove = question.imageFiles.find((image) => image.id === imageId);
        if (imageToRemove) {
          URL.revokeObjectURL(imageToRemove.previewUrl);
        }
        return {
          ...question,
          imageFiles: question.imageFiles.filter((image) => image.id !== imageId),
        };
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
    setQuestions((prev) => {
      if (prev.length <= 1) return prev;
      const target = prev.find((question) => question.key === key);
      if (target) {
        releaseQuestionImages(target.imageFiles);
      }
      delete questionImageInputRefs.current[key];
      return prev.filter((question) => question.key !== key);
    });
  };

  const openAnswerKeyModal = (questionKey: number) => {
    setAnswerKeyModalQuestionKey(questionKey);
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

  const uploadAndAssignQuestionImages = async (
    examId: number,
    createdQuestions: Array<{ id: number; order_index: number }>,
    draftQuestions: DraftQuestion[]
  ) => {
    const questionIdByOrder = new Map<number, number>();
    for (const question of createdQuestions) {
      questionIdByOrder.set(question.order_index, question.id);
    }

    let assigned = 0;
    const failed: string[] = [];
    for (let index = 0; index < draftQuestions.length; index += 1) {
      const imageFiles = draftQuestions[index]?.imageFiles ?? [];
      if (imageFiles.length === 0) continue;

      const questionId = questionIdByOrder.get(index + 1);
      if (!questionId) {
        failed.push(...imageFiles.map((image) => image.file.name));
        continue;
      }

      const uploadedImageIds: number[] = [];
      const uploadedFileNames: string[] = [];
      try {
        for (const image of imageFiles) {
          const formData = new FormData();
          formData.append("file", image.file, image.file.name);
          const uploadResponse = await fetch(`/api/admin/exams/${examId}/resources`, {
            method: "POST",
            body: formData,
          });
          const uploadPayload = (await uploadResponse.json().catch(() => ({}))) as { id?: number };
          if (!uploadResponse.ok || typeof uploadPayload.id !== "number") {
            failed.push(image.file.name);
            continue;
          }
          uploadedImageIds.push(uploadPayload.id);
          uploadedFileNames.push(image.file.name);
        }

        if (uploadedImageIds.length === 0) {
          continue;
        }

        const assignResponse = await fetch(`/api/admin/exams/${examId}/questions/${questionId}/images`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_resource_ids: uploadedImageIds }),
        });
        if (!assignResponse.ok) {
          failed.push(...uploadedFileNames);
          continue;
        }
        assigned += uploadedImageIds.length;
      } catch {
        failed.push(...imageFiles.map((image) => image.file.name));
      }
    }

    return { assigned, failed };
  };

  const onResourceFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = event.target.files ? Array.from(event.target.files) : [];
    setResourceFiles(nextFiles);
  };

  const onQuestionImageFileChange = (questionKey: number, event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = event.target.files ? Array.from(event.target.files) : [];
    appendQuestionImages(questionKey, nextFiles);
    event.target.value = "";
  };

  const createExam = async () => {
    if (loading || uploadingResources) return;
    setShowCreateConfirm(false);
    setError("");
    setMessage("");
    setLoading(true);

    if (!title.trim()) {
      setCreateError("시험 제목을 입력해 주세요.");
      setLoading(false);
      return;
    }
    const normalizedTitle = title.trim().toLowerCase();
    if (existingExamTitles.includes(normalizedTitle)) {
      setCreateError("같은 시험명은 사용할 수 없습니다. 시험명을 다르게 입력해 주세요.");
      setLoading(false);
      return;
    }
    if (!targetTrackName) {
      setCreateError("응시 대상 반을 선택해 주세요.");
      setLoading(false);
      return;
    }
    const parsedStartsAt = startsAtLocal.trim() ? datetimeLocalToUtcIso(startsAtLocal) : null;
    if (startsAtLocal.trim() && !parsedStartsAt) {
      setCreateError("Exam start datetime format is invalid.");
      setLoading(false);
      return;
    }
    let parsedDuration: number | null = null;
    if (!noTimeLimit) {
      parsedDuration = Number.parseInt(durationMinutes.trim(), 10);
      if (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 1440) {
        setCreateError("시험 시간은 1분 이상 1440분 이하로 입력해 주세요.");
        setLoading(false);
        return;
      }
    }

    const normalizedQuestions = [];
    for (const question of questions) {
      if (!question.prompt_md.trim()) {
        setCreateError("모든 문항 내용을 입력해 주세요.");
        setLoading(false);
        return;
      }
      if (question.type === "multiple_choice") {
        const trimmedChoices = question.choices.map((choice) => choice.trim());
        if (trimmedChoices.some((choice) => choice.length === 0)) {
          setCreateError("객관식은 선택지 4개를 모두 입력해 주세요.");
          setLoading(false);
          return;
        }
        const correctChoiceIndexes = normalizeChoiceIndexes(question.correctChoiceIndexes).filter(
          (index) => index >= 0 && index < trimmedChoices.length
        );
        if (correctChoiceIndexes.length === 0) {
          setCreateError("객관식은 정답을 1개 이상 선택해 주세요.");
          setLoading(false);
          return;
        }
        normalizedQuestions.push({
          type: "multiple_choice",
          prompt_md: question.prompt_md.trim(),
          required: question.required,
          choices: trimmedChoices,
          correct_choice_index: correctChoiceIndexes[0] ?? null,
          correct_choice_indexes: correctChoiceIndexes,
          answer_key_text: null,
          image_resource_id: null,
        });
      } else {
        normalizedQuestions.push({
          type: question.type,
          prompt_md: question.prompt_md.trim(),
          required: question.required,
          choices: null,
          correct_choice_index: null,
          correct_choice_indexes: null,
          answer_key_text: question.answerKeyText.trim() || null,
          image_resource_id: null,
        });
      }
    }

    try {
      const response = await fetch("/api/admin/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() ? description.trim() : null,
          folder_id: folderId ? Number(folderId) : null,
          exam_kind: examKind,
          target_track_name: targetTrackName,
          starts_at: parsedStartsAt,
          duration_minutes: parsedDuration,
          status: "published",
          questions: normalizedQuestions,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        id?: number;
        questions?: Array<{
          id: number;
          order_index: number;
        }>;
        detail?: string;
        message?: string;
      };
      if (!response.ok || !payload.id) {
        setCreateError(payload.detail ?? payload.message ?? "시험 생성에 실패했습니다.");
        setLoading(false);
        return;
      }

      const createdQuestions = Array.isArray(payload.questions) ? payload.questions : [];
      const uploadResult = await uploadResourceFilesToExam(payload.id, resourceFiles);
      const questionImageUpload = await uploadAndAssignQuestionImages(payload.id, createdQuestions, questions);
      const failedUploads = [...uploadResult.failed, ...questionImageUpload.failed];
      if (failedUploads.length > 0) {
        setCreateError(`시험은 생성되었지만 리소스 업로드/문항 이미지 연결에 실패한 파일이 있습니다: ${failedUploads.join(", ")}`);
      }

      const uploadMessage =
        uploadResult.uploaded > 0 || questionImageUpload.assigned > 0
          ? `, 리소스 ${uploadResult.uploaded}개 업로드 / 문항 이미지 ${questionImageUpload.assigned}개 연결`
          : "";
      setMessage(`시험을 생성했습니다. (ID: ${payload.id}${uploadMessage})`);
      setExistingExamTitles((prev) => [...prev, normalizedTitle]);
      for (const question of questionsRef.current) {
        releaseQuestionImages(question.imageFiles);
      }
      setTitle("");
      setDescription("");
      setTargetTrackName(TRACK_OPTIONS[0]);
      setStartsAtLocal("");
      setDurationMinutes("60");
      setNoTimeLimit(false);
      setQuestions([newQuestion(Date.now(), "multiple_choice")]);
      questionImageInputRefs.current = {};
      setResourceFiles([]);
      setAnswerKeyModalQuestionKey(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (failedUploads.length > 0) {
        setLoading(false);
        return;
      }
      setLoading(false);
      router.push("/");
      router.refresh();
    } catch {
      setCreateError("시험 생성 중 네트워크 오류가 발생했습니다.");
      setLoading(false);
    }
  };

  return (
    <main className="qa-shell space-y-6">
      <div ref={pageTopRef} />
      <section className="qa-card bg-hero text-hero-foreground">
        <BackButton fallbackHref="/" tone="hero" />
        <p className="qa-kicker mt-4 text-hero-foreground/80">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">시험지 관리</h1>
        <p className="mt-3 text-sm text-hero-foreground/90">
          문항별 정답/채점기준을 입력하면 자동 채점(객관식 기준 채점 + 주관식/코딩 LLM 채점)에 활용됩니다.
        </p>
        <p className="mt-2 text-xs text-hero-foreground/90">
          코드 블록 작성: 문항/설명에 <code>```python</code>으로 시작하고 <code>```</code>으로 닫으면 미리보기와 응시 화면에 코드 블록으로 표시됩니다.
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <section className="qa-card">
        <details open className="space-y-2">
          <summary className="cursor-pointer text-sm font-semibold">튜터용 문제-정답 작성 가이드</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>객관식: 정답 체크박스를 1개 이상 선택하면 됩니다(복수 정답 가능).</li>
            <li>주관식: 정답 키워드와 필수 포함 내용(예: 용어, 근거)을 짧게 적어주세요.</li>
            <li>코딩: 정답 코드 예시 + 체크포인트(선택)을 적어주세요.</li>
            <li>코드 블록: <code>```언어명</code>으로 시작하고 마지막 줄에 <code>```</code>을 입력하세요.</li>
            <li>코딩 리소스 파일명은 데이터 혹은 실습 파일을 업로드해도 됩니다.</li>
            <li>채점기준 도우미 버튼으로 초안을 만든 뒤, 실제 수업 기준에 맞게 수정하면 됩니다. 해당 내용은 선택입니다.</li>
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

        <div className="space-y-2 rounded-xl border border-border/70 bg-surface-muted p-3">
          <p className="text-sm font-medium">시험 시작 일시 (로컬)</p>
          <Input
            type="datetime-local"
            value={startsAtLocal}
            onChange={(event) => setStartsAtLocal(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">비워두면 즉시 응시 가능합니다.</p>
        </div>

        <div className="space-y-2 rounded-xl border border-border/70 bg-surface-muted p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">시험 시간 (분)</p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={noTimeLimit}
                onChange={(event) => setNoTimeLimit(event.target.checked)}
              />
              시간 제한 없음
            </label>
          </div>
          <Input
            type="number"
            min={1}
            max={1440}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            placeholder="예: 60"
            disabled={noTimeLimit}
          />
        </div>

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
                onChange={(event) => {
                  const nextType = event.target.value as QuestionType;
                  if (nextType === "multiple_choice") {
                    updateQuestion(question.key, {
                      type: nextType,
                      correctChoiceIndexes:
                        normalizeChoiceIndexes(question.correctChoiceIndexes).length > 0
                          ? normalizeChoiceIndexes(question.correctChoiceIndexes)
                          : [0],
                    });
                    return;
                  }
                  updateQuestion(question.key, { type: nextType });
                }}
              >
                <option value="multiple_choice">객관식</option>
                <option value="subjective">주관식</option>
                <option value="coding">코딩</option>
              </select>

              <Textarea
                className="mt-2 min-h-48"
                placeholder="문항 내용을 입력해 주세요."
                value={question.prompt_md}
                onChange={(event) => updateQuestion(question.key, { prompt_md: event.target.value })}
                required
              />
              <div className="mt-2 rounded-xl border border-border/70 bg-background/70 p-3">
                <p className="text-[11px] font-semibold text-muted-foreground">문항 미리보기</p>
                {question.imageFiles.length > 0 ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {question.imageFiles.map((image, imageIndex) => (
                      <div
                        key={`${question.key}-${image.id}-preview`}
                        className="overflow-hidden rounded-xl border border-border/70 bg-surface-muted/30"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.previewUrl}
                          alt={`Question ${index + 1} image preview ${imageIndex + 1}`}
                          loading="lazy"
                          className="h-auto max-h-64 w-full object-contain bg-background"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
                <MarkdownContent className="mt-2" content={question.prompt_md} />
              </div>

              <div className="mt-3 rounded-xl border border-border/70 bg-surface-muted p-3">
                <p className="text-xs font-semibold">문항 이미지</p>
                <input
                  ref={(element) => {
                    questionImageInputRefs.current[question.key] = element;
                  }}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => onQuestionImageFileChange(question.key, event)}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => questionImageInputRefs.current[question.key]?.click()}
                  >
                    이미지 파일 선택
                  </Button>
                  <span className="rounded-md border border-border/70 bg-background px-2 py-1 text-xs text-muted-foreground">
                    {question.imageFiles.length > 0 ? `${question.imageFiles.length}개 선택됨` : "선택된 파일 없음"}
                  </span>
                </div>
                {question.imageFiles.length > 0 ? (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {question.imageFiles.map((image, imageIndex) => (
                      <div
                        key={`${question.key}-${image.id}`}
                        className="group relative overflow-hidden rounded-xl border border-border/70 bg-background"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.previewUrl}
                          alt={`Question ${index + 1} image ${imageIndex + 1}`}
                          loading="lazy"
                          className="h-40 w-full object-cover"
                        />
                        <button
                          type="button"
                          className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[11px] font-semibold text-white opacity-0 transition-opacity hover:bg-black/85 group-hover:opacity-100"
                          onClick={() => removeQuestionImage(question.key, image.id)}
                          aria-label={`Remove image ${imageIndex + 1}`}
                        >
                          x
                        </button>
                        <p className="truncate border-t border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
                          {image.file.name}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

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
                          type="checkbox"
                          name={`correct-choice-${question.key}-${choiceIndex}`}
                          checked={normalizeChoiceIndexes(question.correctChoiceIndexes).includes(choiceIndex)}
                          onChange={() => toggleCorrectChoice(question.key, choiceIndex)}
                        />
                        <span className="w-10 text-muted-foreground">{choiceIndex + 1}번</span>
                        <Input
                          placeholder={`${choiceIndex + 1}번 선택지`}
                          value={choice}
                          onChange={(event) => updateChoice(question.key, choiceIndex, event.target.value)}
                        />
                      </label>
                    ))}
                    <p className="text-xs text-muted-foreground">현재 정답: {formatChoiceIndexesLabel(question.correctChoiceIndexes)}</p>
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

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">긴 정답/채점 기준은 큰 입력창에서 작성해 주세요.</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 px-3 text-xs"
                        onClick={() => openAnswerKeyModal(question.key)}
                      >
                        정답/채점 기준
                      </Button>
                    </div>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-2 text-xs leading-5">
                      {question.answerKeyText.trim() || "(아직 입력된 정답/채점 기준이 없습니다.)"}
                    </pre>
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
          <p className="text-sm font-semibold">데이터 및 실습 리소스 업로드</p>
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
          <p className="mt-2 text-xs text-muted-foreground">문항 이미지는 각 문항 카드의 이미지 입력에서 개별 선택해 주세요.</p>
          {!hasCodingQuestion && resourceFiles.length > 0 ? (
            <p className="mt-1 text-xs text-amber-700">현재 코딩 문항이 없지만 리소스는 함께 저장됩니다.</p>
          ) : null}
        </div>

        <Button disabled={loading || uploadingResources}>{loading || uploadingResources ? "생성 중..." : "시험 생성"}</Button>
      </form>

      {answerKeyModalQuestion ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-border/70 bg-white shadow-2xl">
            <div className="border-b border-border/70 px-5 py-4">
              <h3 className="text-lg font-semibold">문항 {answerKeyModalOrder ?? "-"} 정답/채점 기준</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {answerKeyModalQuestion.type === "coding"
                  ? "코딩 문항의 정답 코드/채점 체크포인트를 충분히 길게 입력할 수 있습니다."
                  : "주관식 문항의 정답 키워드/채점 기준을 충분히 자세히 입력할 수 있습니다."}
              </p>
            </div>
            <div className="p-5">
              <Textarea
                className={`min-h-[55vh] ${answerKeyModalQuestion.type === "coding" ? "font-mono text-xs" : "text-sm leading-6"}`}
                placeholder={
                  answerKeyModalQuestion.type === "coding"
                    ? "코딩 정답 코드 + 체크포인트(선택)를 입력해 주세요."
                    : "주관식 정답/채점 기준을 입력해 주세요."
                }
                value={answerKeyModalQuestion.answerKeyText}
                onChange={(event) => updateQuestion(answerKeyModalQuestion.key, { answerKeyText: event.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-4">
              <Button type="button" variant="outline" onClick={() => setAnswerKeyModalQuestionKey(null)}>
                닫기
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-primary/40 bg-white shadow-2xl">
            <div className="bg-gradient-to-r from-primary to-[#d80028] px-5 py-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">확인</p>
              <h3 className="mt-1 text-lg font-bold">시험 생성 확인</h3>
            </div>
            <div className="space-y-3 p-5 text-sm text-foreground">
              <p className="rounded-xl border border-primary/20 bg-secondary/50 p-3">
                <span className="font-semibold">{title.trim() || "(제목 없음)"}</span>
              </p>
              <p>시험을 생성하시겠습니까?</p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border/70 bg-muted/30 px-5 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowCreateConfirm(false)}
                disabled={loading || uploadingResources}
              >
                취소
              </Button>
              <Button type="button" onClick={() => void createExam()} disabled={loading || uploadingResources}>
                {loading || uploadingResources ? "생성 중..." : "생성"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

