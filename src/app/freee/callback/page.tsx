import { redirect } from "next/navigation";
import { FREEE_ISSUER } from "@/lib/freee";
import { matchesFreeeLogin } from "@/lib/security";
import { CompleteLoginForm } from "./complete-login-form";

type Search = Promise<Record<string, string | string[] | undefined>>;
export const dynamic = "force-dynamic";

export default async function FreeeCallback({ searchParams }: { searchParams: Search }) {
  const { state, code, iss, error } = await searchParams;
  if (error) redirect("/?notice=oauth-cancelled");
  if (typeof state !== "string" || typeof code !== "string" || !code || code.length > 4096
    || (iss !== undefined && iss !== FREEE_ISSUER)
    || !(await matchesFreeeLogin(state))) redirect("/?notice=invalid-oauth");

  return (
    <main className="dashboard-login">
      <section className="dashboard-panel">
        <h1 role="status">freeeでログインしています</h1>
        <CompleteLoginForm code={code} state={state} issuer={iss ?? ""} />
      </section>
    </main>
  );
}
