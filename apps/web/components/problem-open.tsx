"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function ProblemOpen() {
  const router = useRouter();
  const [problemId, setProblemId] = useState("1");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = problemId.trim();
    if (!value) {
      return;
    }
    router.push(`/problems/${value}`);
  };

  return (
    <form onSubmit={onSubmit} className="mt-4 flex items-center gap-2" data-testid="problem-open-form">
      <input
        className="w-32 rounded border px-3 py-2"
        placeholder="Problem ID"
        value={problemId}
        onChange={(e) => setProblemId(e.target.value)}
        data-testid="problem-id-input"
      />
      <Button type="submit" data-testid="open-problem-button">
        문제 열기
      </Button>
    </form>
  );
}
