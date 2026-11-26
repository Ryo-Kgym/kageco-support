import { redirect } from "next/navigation";
import { localFreeeCallbackUrl } from "@/lib/freee-settings";
import { requireSession } from "@/lib/security";

export const dynamic = "force-dynamic";

export default async function FreeeSetup() {
  await requireSession();
  const callbackUrl = localFreeeCallbackUrl();
  if (!callbackUrl) redirect("/#freee");

  return (
    <main className="dashboard-login">
      <section className="dashboard-panel" aria-labelledby="freee-setup-heading">
        <header className="panel-heading">
          <h1 id="freee-setup-heading">freeeの接続設定</h1>
          <p><a href="https://app.secure.freee.co.jp/developers/applications" target="_blank" rel="noreferrer">freeeアプリ管理</a>で事業所用のOAuthアプリを開きます。</p>
        </header>
        <dl className="freee-callback-address">
          <dt>freeeに登録するコールバックURL</dt>
          <dd><code>{callbackUrl}</code></dd>
        </dl>
        <p><code>.env.example</code> を参考に、Gitの管理対象外の <code>.env.local</code> に設定します。</p>
        <ul>
          <li><code>FREEE_CLIENT_ID</code> にClient ID</li>
          <li><code>FREEE_CLIENT_SECRET</code> にClient Secret</li>
        </ul>
        <p>設定後、ダッシュボードで「freeeに接続」を押します。設定が反映されない場合は開発サーバーを再起動します。</p>
        <div className="form-footer">
          <a className="dashboard-button secondary" href="/#freee">ダッシュボードに戻る</a>
        </div>
      </section>
    </main>
  );
}
