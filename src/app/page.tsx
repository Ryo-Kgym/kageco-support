import { logout, savePlan, saveTax, setPlanMode } from "@/app/forecast-actions";
import { disconnectFreee, startFreee, syncFreee } from "@/app/freee-actions";
import { ForecastDashboard } from "@/components/forecast-dashboard";
import { APP_NAME } from "@/lib/app-name";
import { getChartAccountItems } from "@/lib/chart-account-items";
import { calculateForecast, FORECAST_YEAR } from "@/lib/forecast";
import { canUseAccessToken, loadForecast } from "@/lib/forecast-store";
import { freeeSettings, localFreeeCallbackUrl } from "@/lib/freee-settings";
import { authConfigured, currentSession, getSessionTokens } from "@/lib/security";

export const maxDuration = 120;

const notices: Record<string, string> = {
  "not-configured": "freeeの接続設定が必要です。",
  "invalid-oauth": "認可の有効期限が切れたか、接続を確認できませんでした。freeeでログインし直してください。",
  "oauth-cancelled": "freeeでのログインをキャンセルしました。",
  "company-required": "freeeで対象の事業所を選択して接続してください。",
  "individual-required": "個人事業主として登録された事業所を選択してください。",
  connected: "freeeでログインしました。「freeeから同期」で実績を取り込めます。",
  disconnected: "freeeとの接続を解除し、ログアウトしました。",
  "disconnect-unconfirmed": "ログアウトしました。freee側で認可が無効になったかは確認できませんでした。",
  "logged-out": "ログアウトしました。",
  "connection-error": "freeeに接続できませんでした。認可情報とコールバックURLを確認してください。",
  "connection-changed": "同期中に接続先が変更されました。もう一度同期してください。",
  "before-year": "対象年の実績を取り込めるのは、対象年の開始後です。",
  synced: "freeeの実績を更新しました。",
  "sync-running": "同期中です。完了後に画面を更新してください。",
  "sync-reconnect": "freeeの認可を更新できませんでした。freeeで再ログインしてから実績を同期してください。",
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
  const session = await currentSession();
  const configured = Boolean(freeeSettings()) && authConfigured();
  const localSetup = Boolean(localFreeeCallbackUrl());
  if (!session) {
    return (
      <main className="dashboard-login">
        <section className="dashboard-panel">
          <header className="panel-heading">
            <h1>{APP_NAME}</h1>
            {configured && <p>freeeで事業所を選んでログインします。</p>}
            {!configured && localSetup && <p>freeeでログインするには、初期設定が必要です。</p>}
          </header>
          {message && <p role="status">{message}</p>}
          {configured ? (
            <form action={startFreee}>
              <button className="dashboard-button" type="submit">freeeでログイン</button>
            </form>
          ) : localSetup ? (
            <a className="dashboard-button secondary" href="/freee/setup">freeeログインの設定方法を見る</a>
          ) : <p>freeeログインの設定を準備中です。</p>}
        </section>
      </main>
    );
  }

  const [data, tokens] = await Promise.all([loadForecast(session), getSessionTokens(session)]);
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
      accountItems={getChartAccountItems(forecast.months, data.actuals)}
      tax={data.tax}
      plans={data.plans}
      monthlyPlanMode={data.monthlyPlanMode}
      lastClosedMonth={data.lastClosedMonth}
      maxClosedMonth={data.maxClosedMonth}
      lastClosedMonthSetting={data.lastClosedMonthSetting}
      connection={{
        configured,
        connected: data.connected,
        canSync: data.connected && tokens !== null && notice !== "sync-reconnect" &&
          (configured || data.canSyncWithoutRefresh || canUseAccessToken(tokens)),
        localSetup,
        companyName: data.companyName,
        syncedAt: data.syncedAt,
        accountItemsNeedSync: data.actuals.some((row) => row.sales !== null && row.expenses !== null && !row.accountItems),
        status: data.tax.consumptionMethod && !data.consumptionMethodConfirmed ? "取り込んだ消費税の申告方式を確認し、「年末の見込みを計算」を押してください。" : null,
      }}
      notice={message}
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
