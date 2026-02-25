import { Suspense } from "react";

import { ResetPasswordClient } from "./reset-password-client";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="qa-shell py-10 text-sm text-muted-foreground">비밀번호 재설정 페이지를 불러오는 중입니다...</div>}>
      <ResetPasswordClient />
    </Suspense>
  );
}
