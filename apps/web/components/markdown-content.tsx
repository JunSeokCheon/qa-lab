"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";

type Segment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string | null };

function parseMarkdownSegments(markdown: string): Segment[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let inCode = false;
  let codeLanguage: string | null = null;

  const flushText = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("\n");
    if (text.trim().length > 0) {
      segments.push({ type: "text", content: text });
    }
    buffer = [];
  };

  const flushCode = () => {
    const code = buffer.join("\n");
    segments.push({ type: "code", content: code, language: codeLanguage });
    buffer = [];
  };

  for (const line of lines) {
    const match = line.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (match) {
      if (inCode) {
        flushCode();
        inCode = false;
        codeLanguage = null;
      } else {
        flushText();
        inCode = true;
        codeLanguage = match[1] ? match[1].toLowerCase() : null;
      }
      continue;
    }

    buffer.push(line);
  }

  if (buffer.length > 0) {
    if (inCode) {
      flushCode();
    } else {
      flushText();
    }
  }

  return segments;
}

export function MarkdownContent({
  content,
  className,
  textClassName,
  codeClassName,
}: {
  content: string | null | undefined;
  className?: string;
  textClassName?: string;
  codeClassName?: string;
}) {
  const normalized = (content ?? "").trimEnd();
  const segments = useMemo(() => parseMarkdownSegments(normalized), [normalized]);

  if (!normalized.trim()) {
    return <p className={cn("text-sm text-muted-foreground", className)}>(내용 없음)</p>;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {segments.map((segment, index) => {
        if (segment.type === "code") {
          return (
            <div key={`code-${index}`} className="overflow-hidden rounded-xl border border-border/70 bg-surface-muted/70">
              <div className="border-b border-border/70 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                {segment.language ?? "code"}
              </div>
              <pre
                className={cn(
                  "max-h-72 overflow-auto px-3 py-2 font-mono text-xs leading-5 whitespace-pre",
                  codeClassName
                )}
              >
                <code>{segment.content}</code>
              </pre>
            </div>
          );
        }

        return (
          <p key={`text-${index}`} className={cn("whitespace-pre-wrap break-words text-sm leading-6", textClassName)}>
            {segment.content}
          </p>
        );
      })}
    </div>
  );
}

