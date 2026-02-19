import { Suspense } from "react";

import { ResetPasswordClient } from "./reset-password-client";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="qa-shell py-10 text-sm text-muted-foreground">Loading reset page...</div>}>
      <ResetPasswordClient />
    </Suspense>
  );
}
