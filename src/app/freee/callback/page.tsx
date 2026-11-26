import { redirect } from "next/navigation";
import { completeFreee } from "@/app/freee-actions";
import { matchesFreeeLogin } from "@/lib/security";

type Search = Promise<Record<string, string | string[] | undefined>>;
export const dynamic = "force-dynamic";

export default async function FreeeCallback({ searchParams }: { searchParams: Search }) {
  const { state, code, iss, error } = await searchParams;
  if (error) redirect("/?notice=oauth-cancelled#freee");
  if (typeof state !== "string" || typeof code !== "string" || !code || code.length > 4096
    || !(await matchesFreeeLogin(state))) redirect("/?notice=invalid-oauth#freee");

  return (
    <main className="dashboard-login">
      <section className="dashboard-panel">
        <h1>freeeでログイン</h1>
        <p>認可した事業所でこのアプリにログインします。</p>
        <form action={completeFreee}>
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="iss" value={typeof iss === "string" ? iss : ""} />
          <button className="dashboard-button" type="submit">ログインを完了</button>
        </form>
        <a href="/">アプリに戻る</a>
      </section>
    </main>
  );
}
