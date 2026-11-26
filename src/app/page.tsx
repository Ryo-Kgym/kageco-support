import { login, logout, savePlan, saveTax, setPlanMode } from "@/app/forecast-actions";
import { disconnectFreee, startFreee, syncFreee } from "@/app/freee-actions";
import { ForecastDashboard } from "@/components/forecast-dashboard";
import { calculateForecast, FORECAST_YEAR } from "@/lib/forecast";
import { loadForecast } from "@/lib/forecast-store";
import { freeeSettings, localFreeeCallbackUrl } from "@/lib/freee-settings";
import { authConfigured, localOpenAccess, sessionId } from "@/lib/security";

export const maxDuration = 120;

const notices: Record<string, string> = {
  "login-failed": "パスワードを確認してください。",
  "not-configured": "freeeの接続設定が必要です。",
  "invalid-oauth": "認可の有効期限が切れたか、接続を確認できませんでした。freee連携をやり直してください。",
  "oauth-cancelled": "freeeへの接続をキャンセルしました。",
  "company-required": "freeeで対象の事業所を選択して接続してください。",
  "individual-required": "個人事業主として登録された事業所を選択してください。",
  "different-company": "このアプリで利用していた事業所を選択してください。このアプリは1つの事業所を対象としています。",
  connected: "freeeに接続しました。「freeeから同期」で実績を取り込めます。",
  disconnected: "freeeとの接続を解除しました。取り込み済みの実績は引き続き表示します。",
  "disconnect-unconfirmed": "アプリでの接続を解除しました。freee側で認可が無効になったかは確認できませんでした。",
  "disconnect-retry": "接続状態が変わりました。もう一度「接続を解除」を押してください。",
  "connection-error": "freeeに接続できませんでした。認可情報とコールバックURLを確認してください。",
  "connection-changed": "同期中に接続先が変更されました。もう一度同期してください。",
  "before-year": "対象年の実績を取り込めるのは、対象年の開始後です。",
  synced: "freeeの実績を更新しました。",
  "sync-running": "同期中です。完了後に画面を更新してください。",
  "sync-reconnect": "freeeの認可を更新できませんでした。「接続を解除」を押した後、「freeeに接続」から同じ事業所に接続してください。",
  "sync-permission": "freeeの参照権限と契約プランを確認してください。",
  "sync-limit": "freeeのリクエスト上限に達しました。時間をおいて再実行してください。",
  "sync-error": "同期できませんでした。前回の同期結果がある場合は引き続き表示します。",
  "invalid-input": "金額は円単位の整数で入力してください。",
  "invalid-closed-month": "締め済みの月は、月末まで取り込み済みの範囲から選択してください。",
  "invalid-plan-month": "締め済みより後の月を選択してください。",
  "tax-saved": "入力内容を年末の見込みに反映しました。",
  "plan-saved": "月ごとの見込みを保存しました。",
  "plan-mode-trend": "推移モードに切り替えました。",
  "plan-mode-manual": "手入力に切り替えました。",
  "manual-plan-required": "見込みを保存するには手入力に切り替えてください。",
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({ searchParams }: { searchParams: Search }) {
  const { notice } = await searchParams;
  const message = typeof notice === "string" && Object.hasOwn(notices, notice) ? notices[notice] : undefined;
  if (!(await sessionId())) {
    return (
      <main className="dashboard-login">
        <section className="dashboard-panel">
          <h1>Kageco 年間収支予測</h1>
          {authConfigured() ? (
            <form action={login}>
              {message && <p role="alert">{message}</p>}
              <label className="form-field">
                <span>パスワード</span>
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
              <button className="dashboard-button" type="submit">ログイン</button>
            </form>
          ) : <p>アプリのログイン設定を準備中です。</p>}
        </section>
      </main>
    );
  }

  const data = await loadForecast();
  const forecast = calculateForecast({
    ...data,
    year: FORECAST_YEAR,
    plans: data.monthlyPlanMode === "manual" ? data.plans : undefined,
    tax: data.consumptionMethodConfirmed ? data.tax : { ...data.tax, consumptionMethod: undefined },
  });

  return (
    <ForecastDashboard
      year={FORECAST_YEAR}
      forecast={forecast}
      tax={data.tax}
      plans={data.plans}
      monthlyPlanMode={data.monthlyPlanMode}
      lastClosedMonth={data.lastClosedMonth}
      maxClosedMonth={data.maxClosedMonth}
      lastClosedMonthSetting={data.lastClosedMonthSetting}
      connection={{
        configured: Boolean(freeeSettings()),
        connected: data.connected,
        localSetup: Boolean(localFreeeCallbackUrl()),
        companyName: data.companyName,
        syncedAt: data.syncedAt,
        status: data.tax.consumptionMethod && !data.consumptionMethodConfirmed ? "取り込んだ消費税の申告方式を確認し、「年末の見込みを計算」を押してください。" : null,
      }}
      notice={message}
      canLogout={!localOpenAccess()}
      actions={{
        startFreee,
        disconnectFreee,
        sync: syncFreee,
        saveTax,
        savePlan,
        setPlanMode,
        logout,
      }}
    />
  );
}
