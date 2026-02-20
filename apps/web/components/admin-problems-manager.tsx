"use client";

import { useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Skill = { id: number; name: string; description?: string | null };
type Folder = { id: number; name: string; slug: string; parent_id: number | null; sort_order: number; path: string };
type ProblemType = "coding" | "multiple_choice" | "subjective";

export function AdminProblemsManager({
  initialSkills,
  initialFolders,
}: {
  initialSkills: Skill[];
  initialFolders: Folder[];
}) {
  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [folders, setFolders] = useState<Folder[]>(initialFolders);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");

  const [folderName, setFolderName] = useState("");
  const [folderParentId, setFolderParentId] = useState("");
  const [folderSortOrder, setFolderSortOrder] = useState("0");

  const [problemTitle, setProblemTitle] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState(initialFolders[0] ? String(initialFolders[0].id) : "");
  const [createdProblemId, setCreatedProblemId] = useState<number | null>(null);

  const [selectedSkillId, setSelectedSkillId] = useState(initialSkills[0] ? String(initialSkills[0].id) : "");
  const [questionType, setQuestionType] = useState<ProblemType>("coding");
  const [difficulty, setDifficulty] = useState("easy");
  const [maxScore, setMaxScore] = useState("100");
  const [statementMd, setStatementMd] = useState("# 데이터 분석 문제\n문제 설명을 입력하세요.");
  const [mcqChoices, setMcqChoices] = useState("A\nB");
  const [mcqCorrectIndex, setMcqCorrectIndex] = useState("1");
  const [subjectiveAnswers, setSubjectiveAnswers] = useState("");
  const [subjectiveCaseSensitive, setSubjectiveCaseSensitive] = useState(false);
  const [createdVersionId, setCreatedVersionId] = useState<number | null>(null);

  const [bundleVersionId, setBundleVersionId] = useState("");
  const [bundleFile, setBundleFile] = useState<File | null>(null);

  const loadSkills = async () => {
    const response = await fetch("/api/admin/skills", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json().catch(() => [])) as Skill[];
    setSkills(payload);
    if (payload.length > 0 && !selectedSkillId) {
      setSelectedSkillId(String(payload[0].id));
    }
  };

  const loadFolders = async () => {
    const response = await fetch("/api/admin/problem-folders", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json().catch(() => [])) as Folder[];
    setFolders(payload);
    if (payload.length > 0 && !selectedFolderId) {
      setSelectedFolderId(String(payload[0].id));
    }
  };

  const createSkill = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const response = await fetch("/api/admin/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: skillName, description: skillDescription || null }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "스킬 생성에 실패했습니다.");
      setLoading(false);
      return;
    }

    setMessage(`스킬 생성 완료 (id=${payload.id})`);
    setSkillName("");
    setSkillDescription("");
    await loadSkills();
    setLoading(false);
  };

  const createFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const response = await fetch("/api/admin/problem-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: folderName,
        parent_id: folderParentId ? Number(folderParentId) : null,
        sort_order: Number(folderSortOrder || "0"),
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; path?: string; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "폴더 생성에 실패했습니다.");
      setLoading(false);
      return;
    }

    setMessage(`폴더 생성 완료 (${payload.path ?? payload.id})`);
    setFolderName("");
    setFolderParentId("");
    setFolderSortOrder("0");
    await loadFolders();
    setLoading(false);
  };

  const createProblem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!selectedFolderId) {
      setError("먼저 폴더를 선택하세요.");
      return;
    }
    setLoading(true);

    const response = await fetch("/api/admin/problems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: problemTitle, folder_id: Number(selectedFolderId) }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "문제 생성에 실패했습니다.");
      setLoading(false);
      return;
    }

    setCreatedProblemId(payload.id);
    setMessage(`문제 생성 완료 (id=${payload.id})`);
    setProblemTitle("");
    setLoading(false);
  };

  const createVersion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!createdProblemId) {
      setError("먼저 문제를 생성하세요.");
      return;
    }

    let questionMeta: Record<string, unknown> | null = null;
    if (questionType === "multiple_choice") {
      const parsedChoices = mcqChoices
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      if (parsedChoices.length < 2) {
        setError("객관식 선택지는 2개 이상이어야 합니다.");
        return;
      }
      const correctIndex = Number(mcqCorrectIndex) - 1;
      if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= parsedChoices.length) {
        setError("정답 번호가 올바르지 않습니다.");
        return;
      }
      questionMeta = { choices: parsedChoices, correct_index: correctIndex };
    }
    if (questionType === "subjective") {
      const answers = subjectiveAnswers
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      if (answers.length === 0) {
        setError("주관식 정답 키를 최소 1줄 입력하세요.");
        return;
      }
      questionMeta = { acceptable_answers: answers, case_sensitive: subjectiveCaseSensitive };
    }

    setLoading(true);
    const response = await fetch(`/api/admin/problems/${createdProblemId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: questionType,
        difficulty,
        max_score: Number(maxScore),
        statement_md: statementMd,
        skills: selectedSkillId ? [{ skill_id: Number(selectedSkillId), weight: 100 }] : [],
        question_meta_json: questionMeta,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "버전 생성에 실패했습니다.");
      setLoading(false);
      return;
    }

    setCreatedVersionId(payload.id);
    setBundleVersionId(String(payload.id));
    setMessage(`버전 생성 완료 (id=${payload.id})`);
    setLoading(false);
  };

  const uploadBundle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!bundleVersionId || !bundleFile) {
      setError("버전 ID와 zip 파일을 입력하세요.");
      return;
    }

    setLoading(true);
    const form = new FormData();
    form.append("file", bundleFile, bundleFile.name);

    const response = await fetch(`/api/admin/problem-versions/${bundleVersionId}/bundle`, {
      method: "POST",
      body: form,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      bundle_key?: string;
      detail?: string;
      message?: string;
    };
    if (!response.ok || !payload.bundle_key) {
      setError(payload.detail ?? payload.message ?? "번들 업로드에 실패했습니다.");
      setLoading(false);
      return;
    }

    setMessage(`번들 업로드 완료 (${payload.bundle_key})`);
    setBundleFile(null);
    setLoading(false);
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/admin" />
        <p className="qa-kicker">관리자</p>
        <h1 className="mt-2 text-3xl font-bold">문제/번들 관리</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          스킬/폴더 생성 {"->"} 폴더에 문제 생성 {"->"} 유형별 버전 생성 {"->"} 번들 업로드(코딩 전용)
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <form className="qa-card space-y-3" onSubmit={createSkill}>
        <h2 className="text-lg font-semibold">1) 스킬 생성</h2>
        <Input placeholder="스킬 이름" value={skillName} onChange={(e) => setSkillName(e.target.value)} required />
        <Input
          placeholder="설명 (선택)"
          value={skillDescription}
          onChange={(e) => setSkillDescription(e.target.value)}
        />
        <Button disabled={loading}>스킬 생성</Button>
      </form>

      <form className="qa-card space-y-3" onSubmit={createFolder}>
        <h2 className="text-lg font-semibold">2) 폴더 생성 (트랙 모듈)</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Input placeholder="폴더 이름 (예: Python)" value={folderName} onChange={(e) => setFolderName(e.target.value)} required />
          <Input
            placeholder="정렬 순서"
            value={folderSortOrder}
            onChange={(e) => setFolderSortOrder(e.target.value)}
          />
          <select
            className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={folderParentId}
            onChange={(e) => setFolderParentId(e.target.value)}
          >
            <option value="">상위 폴더 (선택)</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.path}
              </option>
            ))}
          </select>
        </div>
        <Button disabled={loading}>폴더 생성</Button>
        <div className="grid gap-2 sm:grid-cols-2">
          {folders.map((folder) => (
            <p key={folder.id} className="rounded-xl bg-surface-muted px-3 py-2 text-xs">
              #{folder.id} {folder.path}
            </p>
          ))}
        </div>
      </form>

      <form className="qa-card space-y-3" onSubmit={createProblem}>
        <h2 className="text-lg font-semibold">3) 문제 생성</h2>
        <Input placeholder="문제 제목" value={problemTitle} onChange={(e) => setProblemTitle(e.target.value)} required />
        <select
          className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
          value={selectedFolderId}
          onChange={(e) => setSelectedFolderId(e.target.value)}
          required
        >
          <option value="">폴더 선택</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.path}
            </option>
          ))}
        </select>
        <Button disabled={loading}>문제 생성</Button>
        {createdProblemId ? <p className="text-xs text-muted-foreground">현재 문제 ID: {createdProblemId}</p> : null}
      </form>

      <form className="qa-card space-y-3" onSubmit={createVersion}>
        <h2 className="text-lg font-semibold">4) 유형별 버전 생성</h2>
        <div className="grid gap-3 md:grid-cols-4">
          <Input value={String(createdProblemId ?? "")} readOnly placeholder="문제 ID" />
          <select
            className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
            value={questionType}
            onChange={(e) => setQuestionType(e.target.value as ProblemType)}
          >
            <option value="coding">코딩</option>
            <option value="multiple_choice">객관식</option>
            <option value="subjective">주관식</option>
          </select>
          <Input value={difficulty} onChange={(e) => setDifficulty(e.target.value)} placeholder="난이도" />
          <Input value={maxScore} onChange={(e) => setMaxScore(e.target.value)} placeholder="만점" />
        </div>
        <select
          className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
          value={selectedSkillId}
          onChange={(e) => setSelectedSkillId(e.target.value)}
        >
          <option value="">스킬 (선택)</option>
          {skills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.id} - {skill.name}
            </option>
          ))}
        </select>
        <Textarea value={statementMd} onChange={(e) => setStatementMd(e.target.value)} className="min-h-32" />

        {questionType === "multiple_choice" ? (
          <div className="space-y-2 rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">객관식 설정</p>
            <Textarea
              value={mcqChoices}
              onChange={(e) => setMcqChoices(e.target.value)}
              className="min-h-24"
              placeholder={"선택지 1\n선택지 2\n선택지 3"}
            />
            <Input
              value={mcqCorrectIndex}
              onChange={(e) => setMcqCorrectIndex(e.target.value)}
              placeholder="정답 번호 (1부터)"
            />
          </div>
        ) : null}

        {questionType === "subjective" ? (
          <div className="space-y-2 rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">주관식 설정</p>
            <Textarea
              value={subjectiveAnswers}
              onChange={(e) => setSubjectiveAnswers(e.target.value)}
              className="min-h-24"
              placeholder={"정답 키 1\n정답 키 2"}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={subjectiveCaseSensitive}
                onChange={(e) => setSubjectiveCaseSensitive(e.target.checked)}
              />
              대소문자 구분
            </label>
          </div>
        ) : null}

        <Button disabled={loading}>버전 생성</Button>
        {createdVersionId ? <p className="text-xs text-muted-foreground">현재 버전 ID: {createdVersionId}</p> : null}
      </form>

      <form className="qa-card space-y-3" onSubmit={uploadBundle}>
        <h2 className="text-lg font-semibold">5) 번들 업로드 (.zip, 코딩 전용)</h2>
        <Input
          placeholder="문제 버전 ID"
          value={bundleVersionId}
          onChange={(e) => setBundleVersionId(e.target.value)}
          required
        />
        <Input type="file" accept=".zip" onChange={(e) => setBundleFile(e.target.files?.[0] ?? null)} required />
        <Button disabled={loading}>번들 업로드</Button>
      </form>
    </main>
  );
}
