"use client";

import { useEffect, useRef } from "react";
import { completeFreee } from "@/app/freee-actions";

export function CompleteLoginForm({ code, state, issuer }: { code: string; state: string; issuer: string }) {
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  useEffect(() => {
    if (!form.current || submitted.current) return;
    submitted.current = true;
    form.current.requestSubmit();
  }, []);

  return (
    <form ref={form} action={completeFreee}>
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="iss" value={issuer} />
      <noscript>
        <button className="dashboard-button" type="submit">ログインを完了</button>
      </noscript>
    </form>
  );
}
