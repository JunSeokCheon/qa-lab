"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BackButtonProps = {
  fallbackHref?: string;
  className?: string;
  tone?: "default" | "hero";
  useFallbackOnly?: boolean;
};

export function BackButton({ fallbackHref = "/", className, tone = "default", useFallbackOnly = false }: BackButtonProps) {
  const router = useRouter();

  const onGoBack = () => {
    if (!useFallbackOnly && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={onGoBack}
      className={cn(
        "mb-4",
        tone === "hero" &&
          "border-white/45 bg-white/10 text-hero-foreground hover:bg-white/20 hover:text-hero-foreground",
        className
      )}
    >
      뒤로 가기
    </Button>
  );
}
