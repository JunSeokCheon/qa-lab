"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BackButtonProps = {
  fallbackHref?: string;
  className?: string;
};

export function BackButton({ fallbackHref = "/", className }: BackButtonProps) {
  const router = useRouter();

  const onGoBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <Button type="button" variant="outline" onClick={onGoBack} className={cn("mb-4", className)}>
      뒤로 가기
    </Button>
  );
}
