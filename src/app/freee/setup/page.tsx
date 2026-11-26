import { redirect } from "next/navigation";
import { configureAndStartFreee } from "@/app/freee-actions";
import { connectionDetails } from "@/lib/forecast-store";
import { localFreeeCallbackUrl } from "@/lib/freee-settings";
import { getMode, requireSession } from "@/lib/security";

type Search = Promise<Record<string, string | string[] | undefined>>;

export const dynamic = "force-dynamic";

export default async function FreeeSetup({ searchParams }: { searchParams: Search }) {
  await requireSession();
  const callbackUrl = localFreeeCallbackUrl();
  if (!callbackUrl || await getMode() !== "real" || await connectionDetails()) redirect("/#freee");
  const { error } = await searchParams;

  return (
    <main className="dashboard-login">
      <section className="dashboard-panel" aria-labelledby="freee-setup-heading">
        <header className="panel-heading">
          <h1 id="freee-setup-heading">freeeに接続</h1>
          <p><a href="https://app.secure.freee.co.jp/developers/applications" target="_blank" rel="noreferrer">freeeアプリ管理</a>で、事業所用のOAuthアプリを開いてください。</p>
        </header>
        <dl className="freee-callback-address">
          <dt>freeeに登録するコールバックURL</dt>
          <dd><code>{callbackUrl}</code></dd>
        </dl>
        <form action={configureAndStartFreee} className="editable-form" autoComplete="off">
          {error === "credentials" && <p className="dashboard-notice" role="alert">Client IDとClient Secretの入力を確認してください。</p>}
          <label className="form-field">
            <span>Client ID</span>
            <input name="clientId" type="text" required maxLength={512} autoCapitalize="off" spellCheck={false} />
          </label>
          <label className="form-field">
            <span>Client Secret</span>
            <input name="clientSecret" type="password" required maxLength={1024} autoComplete="off" />
          </label>
          <p className="form-hint">接続設定はサーバー起動中だけ保持します。</p>
          <div className="form-footer">
            <a className="dashboard-button secondary" href="/#freee">戻る</a>
            <button className="dashboard-button" type="submit">freeeで認証する</button>
          </div>
        </form>
      </section>
    </main>
  );
}
