"use client";

import { useState, type FormEvent } from "react";

import { BackButton } from "@/components/back-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Skill = { id: number; name: string; description?: string | null };

export function AdminProblemsManager({ initialSkills }: { initialSkills: Skill[] }) {
  const [skills, setSkills] = useState<Skill[]>(initialSkills);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");

  const [problemTitle, setProblemTitle] = useState("");
  const [createdProblemId, setCreatedProblemId] = useState<number | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState(initialSkills[0] ? String(initialSkills[0].id) : "");
  const [difficulty, setDifficulty] = useState("easy");
  const [maxScore, setMaxScore] = useState("100");
  const [statementMd, setStatementMd] = useState("# Problem\nWrite the prompt here.");
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
      setError(payload.detail ?? payload.message ?? "Failed to create skill");
      setLoading(false);
      return;
    }

    setMessage(`Skill created (id=${payload.id})`);
    setSkillName("");
    setSkillDescription("");
    await loadSkills();
    setLoading(false);
  };

  const createProblem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    const response = await fetch("/api/admin/problems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: problemTitle }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "Failed to create problem");
      setLoading(false);
      return;
    }

    setCreatedProblemId(payload.id);
    setMessage(`Problem created (id=${payload.id})`);
    setProblemTitle("");
    setLoading(false);
  };

  const createVersion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!createdProblemId) {
      setError("Create a problem first.");
      return;
    }
    if (!selectedSkillId) {
      setError("Select a skill.");
      return;
    }

    setLoading(true);
    const response = await fetch(`/api/admin/problems/${createdProblemId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "coding",
        difficulty,
        max_score: Number(maxScore),
        statement_md: statementMd,
        skills: [{ skill_id: Number(selectedSkillId), weight: 100 }],
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: number; detail?: string; message?: string };
    if (!response.ok || !payload.id) {
      setError(payload.detail ?? payload.message ?? "Failed to create version");
      setLoading(false);
      return;
    }

    setCreatedVersionId(payload.id);
    setBundleVersionId(String(payload.id));
    setMessage(`Version created (id=${payload.id})`);
    setLoading(false);
  };

  const uploadBundle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!bundleVersionId || !bundleFile) {
      setError("Enter version id and select a zip file.");
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
      setError(payload.detail ?? payload.message ?? "Failed to upload bundle");
      setLoading(false);
      return;
    }

    setMessage(`Bundle uploaded (${payload.bundle_key})`);
    setBundleFile(null);
    setLoading(false);
  };

  return (
    <main className="qa-shell space-y-6">
      <section className="qa-card">
        <BackButton fallbackHref="/admin" />
        <p className="qa-kicker">Admin</p>
        <h1 className="mt-2 text-3xl font-bold">Problem and Bundle Manager</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {"Flow: create skill -> create problem -> create version -> upload zip bundle."}
        </p>
      </section>

      {error ? <p className="qa-card text-sm text-destructive">{error}</p> : null}
      {message ? <p className="qa-card text-sm text-emerald-700">{message}</p> : null}

      <form className="qa-card space-y-3" onSubmit={createSkill}>
        <h2 className="text-lg font-semibold">1) Create Skill</h2>
        <Input placeholder="skill name" value={skillName} onChange={(e) => setSkillName(e.target.value)} required />
        <Input
          placeholder="description (optional)"
          value={skillDescription}
          onChange={(e) => setSkillDescription(e.target.value)}
        />
        <Button disabled={loading}>Create skill</Button>
      </form>

      <form className="qa-card space-y-3" onSubmit={createProblem}>
        <h2 className="text-lg font-semibold">2) Create Problem</h2>
        <Input placeholder="problem title" value={problemTitle} onChange={(e) => setProblemTitle(e.target.value)} required />
        <Button disabled={loading}>Create problem</Button>
        {createdProblemId ? <p className="text-xs text-muted-foreground">current problem id: {createdProblemId}</p> : null}
      </form>

      <form className="qa-card space-y-3" onSubmit={createVersion}>
        <h2 className="text-lg font-semibold">3) Create Version</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Input value={String(createdProblemId ?? "")} readOnly placeholder="problem id" />
          <Input value={difficulty} onChange={(e) => setDifficulty(e.target.value)} placeholder="difficulty" />
          <Input value={maxScore} onChange={(e) => setMaxScore(e.target.value)} placeholder="max score" />
        </div>
        <select
          className="h-11 w-full rounded-xl border border-border/70 bg-background/80 px-3 text-sm"
          value={selectedSkillId}
          onChange={(e) => setSelectedSkillId(e.target.value)}
        >
          <option value="">select skill</option>
          {skills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.id} - {skill.name}
            </option>
          ))}
        </select>
        <Textarea value={statementMd} onChange={(e) => setStatementMd(e.target.value)} className="min-h-32" />
        <Button disabled={loading}>Create version</Button>
        {createdVersionId ? <p className="text-xs text-muted-foreground">current version id: {createdVersionId}</p> : null}
      </form>

      <form className="qa-card space-y-3" onSubmit={uploadBundle}>
        <h2 className="text-lg font-semibold">4) Upload Bundle (.zip)</h2>
        <Input
          placeholder="problem version id"
          value={bundleVersionId}
          onChange={(e) => setBundleVersionId(e.target.value)}
          required
        />
        <Input
          type="file"
          accept=".zip"
          onChange={(e) => setBundleFile(e.target.files?.[0] ?? null)}
          required
        />
        <Button disabled={loading}>Upload bundle</Button>
      </form>
    </main>
  );
}
