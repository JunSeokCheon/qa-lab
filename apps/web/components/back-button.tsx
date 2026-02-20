"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function BackButton({ fallbackHref = "/" }: { fallbackHref?: string }) {
  const router = useRouter();

  const onGoBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <Button type="button" variant="outline" onClick={onGoBack}>
      뒤로 가기
    </Button>
  );
}
