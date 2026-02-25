"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type ExamItem = {
  id: number;
  title: string;
  folder_path: string | null;
  exam_kind: string;
  question_count: number;
  submitted: boolean;
};

const ALL_CATEGORY = "__all__";

function examKindLabel(examKind: string): string {
  if (examKind === "quiz") return "퀴즈";
  if (examKind === "assessment") return "성취도 평가";
  return examKind;
}

export function ExamCategoryBrowser({ items }: { items: ExamItem[] }) {
  const categories = useMemo(() => {
    return Array.from(new Set(items.map((item) => item.folder_path).filter(Boolean))) as string[];
  }, [items]);

  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORY);
  const effectiveCategory =
    activeCategory === ALL_CATEGORY || categories.includes(activeCategory) ? activeCategory : ALL_CATEGORY;

  const filtered = useMemo(() => {
    if (effectiveCategory === ALL_CATEGORY) return items;
    return items.filter((item) => item.folder_path === effectiveCategory);
  }, [effectiveCategory, items]);

  return (
    <section className="qa-card space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={effectiveCategory === ALL_CATEGORY ? "default" : "outline"}
          onClick={() => setActiveCategory(ALL_CATEGORY)}
        >
          전체
        </Button>
        {categories.map((category) => (
          <Button
            key={category}
            type="button"
            variant={effectiveCategory === category ? "default" : "outline"}
            onClick={() => setActiveCategory(category)}
          >
            {category}
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">선택한 카테고리에 시험이 없습니다.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((exam) => (
            <article key={exam.id} className="rounded-2xl border border-border/70 bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">{exam.title}</h3>
                  <p className="text-xs text-muted-foreground">{exam.question_count}문항</p>
                </div>
                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                  {examKindLabel(exam.exam_kind)}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between">
                {exam.submitted ? (
                  <p className="text-xs font-semibold text-emerald-700">제출 완료</p>
                ) : (
                  <p className="text-xs text-muted-foreground">아직 제출하지 않았습니다.</p>
                )}
                <Link href={`/problems/${exam.id}`} className="text-sm font-semibold underline">
                  {exam.submitted ? "응답 보기" : "시험 시작"}
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
