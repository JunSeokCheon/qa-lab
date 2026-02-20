"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type ProblemItem = {
  id: number;
  title: string;
  folder_id: number | null;
  folder_path: string | null;
  latest_version: { id: number; version: number; type: string; difficulty: string; max_score: number } | null;
};

function typeLabel(type: string): string {
  if (type === "coding") return "코드";
  if (type === "multiple_choice") return "객관식";
  if (type === "subjective") return "주관식";
  return type;
}

function difficultyLabel(difficulty: string): string {
  if (difficulty === "easy") return "쉬움";
  if (difficulty === "medium") return "보통";
  if (difficulty === "hard") return "어려움";
  return difficulty;
}

export function ProblemCategoryBrowser({ items }: { items: ProblemItem[] }) {
  const categories = useMemo(() => {
    const values = Array.from(new Set(items.map((item) => item.folder_path).filter(Boolean))) as string[];
    return values;
  }, [items]);

  const [activeCategory, setActiveCategory] = useState<string>(categories[0] ?? "");

  const filtered = useMemo(() => {
    if (!activeCategory) return items;
    return items.filter((item) => item.folder_path === activeCategory);
  }, [activeCategory, items]);

  return (
    <section className="qa-card space-y-4">
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <Button
            key={category}
            variant={activeCategory === category ? "default" : "outline"}
            onClick={() => setActiveCategory(category)}
            type="button"
          >
            {category}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">선택한 카테고리에 문제가 없습니다.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((problem) => (
            <article key={problem.id} className="rounded-2xl border border-border/70 bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">{problem.title}</h3>
                  <p className="text-xs text-muted-foreground">문제 #{problem.id}</p>
                </div>
                {problem.latest_version ? (
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                    {typeLabel(problem.latest_version.type)}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {problem.latest_version
                  ? `v${problem.latest_version.version} | ${difficultyLabel(problem.latest_version.difficulty)} | ${problem.latest_version.max_score}점`
                  : "공개된 버전이 없습니다."}
              </p>
              <Link href={`/problems/${problem.id}`} className="mt-3 inline-block text-sm font-semibold underline">
                문제 풀기
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
