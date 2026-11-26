import { logout, saveClosedMonth, saveIndividualClosedMonths, savePlan, saveTax, setPlanMode } from "@/app/forecast-actions";
import { disconnectFreee, startFreee, syncFreee } from "@/app/freee-actions";
import { ForecastDashboard } from "@/components/forecast-dashboard";
import { APP_NAME } from "@/lib/app-name";
import { getChartAccountItems } from "@/lib/chart-account-items";
import { calculateForecast } from "@/lib/forecast";
import { canUseAccessToken, loadForecast } from "@/lib/forecast-store";
import { forecastYears, selectedForecastYear } from "@/lib/forecast-year";
import { freeeConfiguration } from "@/lib/freee-settings";
import { authConfigured, currentSession, getSessionTokens } from "@/lib/security";

export const maxDuration = 120;

const notices: Record<string, string> = {
  "not-configured": "freeeの接続設定が必要です。",
  "invalid-oauth": "認可の有効期限が切れたか、接続を確認できませんでした。freeeでログインし直してください。",
  "oauth-cancelled": "freeeでのログインをキャンセルしました。",
  "company-required": "freeeで対象の事業所を選択して接続してください。",
  "individual-required": "個人事業主として登録された事業所を選択してください。",
  connected: "freeeでログインしました。",
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
  "invalid-medical-expense-deduction": "医療費控除額は200万円以下を入力してください。",
  "invalid-closed-month": "締め済みの月は、月末まで取り込み済みの範囲から選択してください。",
  "invalid-summary-closed-month": "締め済み最終月は、前月までの範囲から選択してください。",
  "invalid-plan-month": "売上または支出が未締めの月を選択してください。",
  "closed-month-saved": "締め済み最終月を売上と経費に反映しました。",
  "individual-closed-months-saved": "売上と経費の締め月を保存しました。",
  "tax-saved": "入力内容を年末の見込みに反映しました。",
  "plan-saved": "月ごとの見込みを保存しました。",
  "plan-mode-trend": "推移モードに切り替えました。",
  "plan-mode-manual": "手入力に切り替えました。",
  "manual-plan-required": "見込みを保存するには手入力に切り替えてください。",
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({ searchParams }: { searchParams: Search }) {
  const { notice, year: yearParam } = await searchParams;
  const years = forecastYears();
  const year = selectedForecastYear(yearParam, years);
  const message = typeof notice === "string" && Object.hasOwn(notices, notice) ? notices[notice] : undefined;
  const closedMonthsNotice = notice === "individual-closed-months-saved" || notice === "invalid-closed-month" ? message : undefined;
  const session = await currentSession();
  const { settings, issues } = freeeConfiguration();
  const sessionConfigured = authConfigured();
  const configured = Boolean(settings) && sessionConfigured;
  if (!session) {
    const localIssues = process.env.NODE_ENV === "development"
      ? [...issues, ...(sessionConfigured ? [] : ["SESSION_SECRET"])]
      : [];
    return (
      <main className="dashboard-login">
        <section className="dashboard-panel login-panel" aria-labelledby="login-heading">
          <header className="panel-heading">
            <h1 id="login-heading">{APP_NAME}</h1>
            <p>freeeアカウントでログインし、試算に使う事業所を選びます。</p>
          </header>
          {message && <p className="dashboard-notice" role="status">{message}</p>}
          <form action={startFreee}>
            <button className="dashboard-button" type="submit" disabled={!configured} aria-describedby={configured ? undefined : "login-unavailable"}>
              freeeでログイン
            </button>
          </form>
          {!configured && (
            <div className="login-configuration" id="login-unavailable">
              <strong>freeeログインを開始できません</strong>
              {localIssues.length > 0 ? (
                <>
                  <p><code>.env.local</code> で次の設定を確認してください。</p>
                  <ul>{localIssues.map((key) => <li key={key}><code>{key}</code></li>)}</ul>
                </>
              ) : <p>この環境のログイン設定が完了していません。</p>}
            </div>
          )}
        </section>
      </main>
    );
  }

  const [data, tokens] = await Promise.all([loadForecast(session, year), getSessionTokens(session)]);
  const forecast = calculateForecast({
    ...data,
    year,
    plans: data.monthlyPlanMode === "manual" ? data.plans : undefined,
    tax: data.consumptionMethodConfirmed ? data.tax : { ...data.tax, consumptionMethod: undefined },
  });

  return (
    <ForecastDashboard
      key={year}
      year={year}
      years={years}
      forecast={forecast}
      accountItems={getChartAccountItems(forecast.months, data.actuals)}
      tax={data.tax}
      plans={data.plans}
      monthlyPlanMode={data.monthlyPlanMode}
      lastClosedSalesMonth={data.lastClosedSalesMonth}
      lastClosedExpenseMonth={data.lastClosedExpenseMonth}
      defaultClosedMonth={data.defaultClosedMonth}
      maxClosedMonth={data.maxClosedMonth}
      lastClosedMonthSetting={data.lastClosedMonthSetting}
      lastClosedSalesMonthSetting={data.lastClosedSalesMonthSetting}
      lastClosedExpenseMonthSetting={data.lastClosedExpenseMonthSetting}
      connection={{
        configured,
        connected: data.connected,
        canSync: data.connected && tokens !== null && notice !== "sync-reconnect" &&
          (configured || data.canSyncWithoutRefresh || canUseAccessToken(tokens)),
        companyName: data.companyName,
        syncedAt: data.syncedAt,
        accountItemsNeedSync: data.actuals.some((row) => row.sales !== null && row.expenses !== null && !row.accountItems),
        status: data.tax.consumptionMethod && !data.consumptionMethodConfirmed ? "取り込んだ消費税の申告方式を確認し、「年末の見込みを計算」を押してください。" : null,
      }}
      notice={closedMonthsNotice === undefined ? message : undefined}
      closedMonthsNotice={closedMonthsNotice}
      actions={{
        startFreee,
        disconnectFreee,
        sync: syncFreee.bind(null, year),
        saveClosedMonth: saveClosedMonth.bind(null, year),
        saveIndividualClosedMonths: saveIndividualClosedMonths.bind(null, year),
        saveTax: saveTax.bind(null, year),
        savePlan: savePlan.bind(null, year),
        setPlanMode: setPlanMode.bind(null, year),
        logout,
      }}
    />
  );
}
