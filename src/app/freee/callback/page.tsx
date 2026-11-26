import { redirect } from "next/navigation";
import { completeFreee } from "@/app/freee-actions";
import { requireSession } from "@/lib/security";

type Search = Promise<Record<string, string | string[] | undefined>>;
export const dynamic = "force-dynamic";

export default async function FreeeCallback({ searchParams }: { searchParams: Search }) {
  await requireSession();
  const { state, code, iss, error } = await searchParams;
  if (error) redirect("/?notice=oauth-cancelled#freee");
  if (typeof state !== "string" || typeof code !== "string") redirect("/?notice=invalid-oauth#freee");

  return (
    <main className="dashboard-login">
      <section className="dashboard-panel">
        <h1>freee会計に接続</h1>
        <p>認可した事業所をこのアプリに接続します。</p>
        <form action={completeFreee}>
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="iss" value={typeof iss === "string" ? iss : ""} />
          <button className="dashboard-button" type="submit">接続を完了</button>
        </form>
        <a href="/#freee">ダッシュボードに戻る</a>
      </section>
    </main>
  );
}
