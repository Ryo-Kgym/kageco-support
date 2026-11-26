import type { CSSProperties } from "react";
import type { ForecastResult, MonthAmounts, TaxInputs } from "@/lib/forecast";

type FormAction = (formData: FormData) => Promise<void>;
type DashboardProps = {
  year: number;
  isDemo: boolean;
  forecast: ForecastResult;
  tax: TaxInputs;
  plans: MonthAmounts[];
  lastClosedMonth: number;
  maxClosedMonth: number;
  lastClosedMonthSetting: number | null;
  connection: {
    configured: boolean;
    localSetup?: boolean;
    companyName: string | null;
    syncedAt: string | null;
    status?: string | null;
  };
  notice?: string;
  actions: {
    startFreee: FormAction;
    sync: FormAction;
    saveTax: FormAction;
    savePlan: FormAction;
    setDemo: FormAction;
    logout: FormAction;
  };
  canLogout: boolean;
};

const months = Array.from({ length: 12 }, (_, index) => index + 1);
const yenFormat = new Intl.NumberFormat("ja-JP");
const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "short",
  timeStyle: "short",
});

function yen(amount: number | null | undefined) {
  return amount == null ? "未算出" : `${yenFormat.format(amount)}円`;
}

function settlement(amount: number | null) {
  if (amount === null) return "未算出";
  if (amount < 0) return `還付 ${yen(-amount)}`;
  return amount > 0 ? `追加納付 ${yen(amount)}` : "0円";
}

function MetricCard({
  title,
  amount,
  caption,
  details,
  highlighted = false,
}: {
  title: string;
  amount: number | null;
  caption: string;
  details?: Array<{ label: string; value: string }>;
  highlighted?: boolean;
}) {
  return (
    <article className={`metric-card${highlighted ? " income" : ""}`}>
      <h3>{title}</h3>
      <p className={`metric-amount${amount === null ? " unavailable" : ""}`}>
        {amount === null ? "未算出" : <>{yenFormat.format(amount)}<span className="amount-unit">円</span></>}
      </p>
      <p className="metric-caption">{caption}</p>
      {details && (
        <dl className="metric-detail">
          {details.map(({ label, value }) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      )}
    </article>
  );
}

function MonthlyChart({ forecast: { months: rows } }: { forecast: ForecastResult }) {
  const amounts = rows.flatMap(({ forecast }) => [forecast.sales, forecast.expenses]);
  const available = amounts.some((value) => value !== null);
  const ceiling = Math.max(0, ...amounts.map((value) => value ?? 0));
  const floor = Math.min(0, ...amounts.map((value) => value ?? 0));
  const range = ceiling - floor || 1;
  const baseline = -floor / range;
  const chartStyle = { "--chart-zero": `${baseline * 100}%` } as CSSProperties;

  const makeBar = (value: number | null, expense: boolean, source: string) => {
    const className = `chart-bar${expense ? " bar-expenses" : ""}${source !== "actual" ? " is-forecast" : ""}`;
    const bottom = (value !== null && value < 0 ? baseline + value / range : baseline) * 100;
    const style = {
      "--bar-height": `${Math.abs(value ?? 0) / range * 100}%`,
      "--bar-bottom": `${bottom}%`,
    } as CSSProperties;
    return (
      <span className="chart-bar-track">
        {value !== null && <span className={className} style={style} />}
      </span>
    );
  };

  return (
    <section className="dashboard-panel" id="monthly" aria-labelledby="monthly-heading">
      <header className="panel-heading">
        <h2 id="monthly-heading">月ごとの事業収支</h2>
        <p>締め済みの実績と各月の着地見込み</p>
      </header>
      {available ? (
        <>
          <ul className="chart-legend" aria-hidden="true">
            <li><span className="legend-swatch" />売上</li>
            <li><span className="legend-swatch bar-expenses" />経費</li>
            <li><span className="legend-swatch is-forecast" />見込み</li>
          </ul>
          <div className="chart-scroll" aria-hidden="true">
            <div className="monthly-chart" style={chartStyle}>
              {rows.map((row) => (
                <div className="chart-month" key={row.month} title={`${row.month}月 売上 ${yen(row.forecast.sales)}・経費 ${yen(row.forecast.expenses)}`}>
                  <div className="chart-month-bars">
                    <span className="chart-baseline" />
                    {makeBar(row.forecast.sales, false, row.sources.sales)}
                    {makeBar(row.forecast.expenses, true, row.sources.expenses)}
                  </div>
                  <span className={`chart-month-label${row.closed ? "" : " is-projected"}`}>{row.month}月</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="chart-empty"><p>freeeから同期するか、月ごとの見込みを入力してください。</p></div>
      )}
      <details className="monthly-detail">
        <summary>月別の金額を表示</summary>
        <div className="table-scroll">
          <table className="month-table" aria-label="事業売上と経費の月別実績・見込み">
            <thead>
              <tr>
                <th scope="col">月</th>
                <th scope="col" className="numeric-cell">売上実績</th>
                <th scope="col" className="numeric-cell">経費実績</th>
                <th scope="col" className="numeric-cell">売上見込み</th>
                <th scope="col" className="numeric-cell">経費見込み</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ month, closed, actual, forecast }) => (
                <tr key={month}>
                  <th scope="row">{month}月</th>
                  <td className="numeric-cell">{yen(actual.sales)}</td>
                  <td className="numeric-cell">{yen(actual.expenses)}</td>
                  <td className="numeric-cell">{closed ? "締め済み" : yen(forecast.sales)}</td>
                  <td className="numeric-cell">{closed ? "締め済み" : yen(forecast.expenses)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function ConnectionPanel({ connection, lastClosedMonth, actions, isDemo }: Pick<DashboardProps, "connection" | "lastClosedMonth" | "actions" | "isDemo">) {
  const connected = connection.companyName !== null;
  const connectionLabel = !connection.configured ? "接続設定が必要" : connected ? "接続済み" : "未接続";
  const syncTime = connection.syncedAt ? timeFormat.format(new Date(connection.syncedAt)) : "未同期";

  return (
    <section className="dashboard-panel" id="freee" aria-labelledby="connection-heading">
      <header className="panel-heading">
        <h2 id="connection-heading">freee会計</h2>
      </header>
      <p className={`connection-state${connection.configured && connected ? "" : " inactive"}`}>{connectionLabel}</p>
      <dl className="connection-meta">
        <div><dt>事業所</dt><dd>{connection.companyName ?? "未選択"}</dd></div>
        <div><dt>最終同期</dt><dd>{syncTime}</dd></div>
        <div><dt>締め済み実績</dt><dd>{lastClosedMonth === 0 ? "未指定" : `${lastClosedMonth}月まで`}</dd></div>
      </dl>
      {connection.status && <p className="connection-message">{connection.status}</p>}
      {connection.configured && !isDemo && (
        <div className="connection-actions">
          {connected && (
            <form action={actions.sync}>
              <button className="dashboard-button" type="submit">freeeから同期</button>
            </form>
          )}
          <form action={actions.startFreee}>
            <button className={`dashboard-button${connected ? " secondary" : ""}`} type="submit">
              {connected ? "再接続" : "freeeに接続"}
            </button>
          </form>
        </div>
      )}
      {!connection.configured && connection.localSetup && (
        <div className="connection-actions">
          <a className="dashboard-button" href="/freee/setup">接続設定の手順を見る</a>
        </div>
      )}
      {isDemo && connection.configured && (
        <div className="connection-actions">
          <form action={actions.startFreee}>
            <button className="dashboard-button" type="submit">実データを接続</button>
          </form>
        </div>
      )}
    </section>
  );
}

function AmountField({ name, label, value, signed = false }: {
  name: string;
  label: string;
  value?: number | null;
  signed?: boolean;
}) {
  return (
    <label className="form-field">
      <span>{label}（円）</span>
      <input type="number" name={name} defaultValue={value ?? ""} min={signed ? undefined : 0} step="1" inputMode={signed ? "decimal" : "numeric"} />
    </label>
  );
}

function TaxForm({ tax, lastClosedMonthSetting, maxClosedMonth, action }: {
  tax: TaxInputs;
  lastClosedMonthSetting: number | null;
  maxClosedMonth: number;
  action: FormAction;
}) {
  return (
    <section className="dashboard-panel" aria-labelledby="tax-heading">
      <header className="panel-heading">
        <h2 id="tax-heading">年の前提と税金</h2>
        <p>金額がない項目には0円を入力します。入力はサーバー起動中だけ保持します。</p>
      </header>
      <form action={action} className="editable-form">
        <fieldset className="form-group">
          <legend>収入と控除</legend>
          <div className="field-grid">
            <label className="form-field">
              <span>締め済みの最終月</span>
              <select name="lastClosedMonth" defaultValue={lastClosedMonthSetting ?? ""}>
                <option value="">自動（同期済みの最終月）</option>
                <option value={0}>締め済みの月なし</option>
                {months.slice(0, maxClosedMonth).map((month) => <option key={month} value={month}>{month}月</option>)}
              </select>
            </label>
            <AmountField name="salaryGross" label="給与・賞与の年額" value={tax.salaryGross} />
            <AmountField name="blueDeduction" label="青色申告特別控除" value={tax.blueDeduction} />
            <AmountField name="socialInsurance" label="社会保険料控除" value={tax.socialInsurance} />
            <AmountField name="otherIncomeDeductions" label="その他の所得控除" value={tax.otherIncomeDeductions} />
            <AmountField name="incomeTaxCredit" label="所得税の税額控除" value={tax.incomeTaxCredit} />
            <AmountField name="withheldIncomeTax" label="源泉徴収税額" value={tax.withheldIncomeTax} />
            <AmountField name="prepaidIncomeTax" label="所得税の予定納税額" value={tax.prepaidIncomeTax} />
          </div>
          <p className="form-hint">その他の所得控除には、所得税の扶養控除などを入力します。</p>
        </fieldset>
        <fieldset className="form-group">
          <legend>ふるさと納税</legend>
          <div className="field-grid">
            <AmountField name="donationsPaid" label="寄附済額" value={tax.donationsPaid} />
            <AmountField name="donationsPlanned" label="今後の寄附予定額" value={tax.donationsPlanned} />
            <label className="form-field">
              <span>寄附控除の手続き</span>
              <select name="donationMethod" defaultValue={tax.donationMethod ?? ""}>
                <option value="">未選択</option>
                <option value="return">確定申告</option>
                <option value="one-stop">ワンストップ特例</option>
              </select>
            </label>
            <AmountField name="otherResidentDeductions" label="住民税のその他の所得控除" value={tax.otherResidentDeductions} />
            <AmountField name="residentPersonalDeductionDifference" label="基礎控除以外の人的控除差" value={tax.residentPersonalDeductionDifference} />
            <AmountField name="residentAdjustmentDeduction" label="住民税の調整控除（任意）" value={tax.residentAdjustmentDeduction} />
          </div>
          <p className="form-hint">控除の入力には給与明細や住民税の通知書を参照できます。</p>
        </fieldset>
        <fieldset className="form-group">
          <legend>消費税</legend>
          <div className="field-grid">
            <label className="form-field">
              <span>申告方式</span>
              <select name="consumptionMethod" defaultValue={tax.consumptionMethod ?? ""}>
                <option value="">未選択</option>
                <option value="exempt">免税</option>
                <option value="general">一般課税</option>
                <option value="simplified">簡易課税</option>
                <option value="two-tenths">2割特例</option>
              </select>
            </label>
            <label className="form-field">
              <span>簡易課税のみなし仕入率</span>
              <select name="simplifiedPurchaseRate" defaultValue={tax.simplifiedPurchaseRate ?? ""}>
                <option value="">未選択</option>
                {[90, 80, 70, 60, 50, 40].map((rate, index) => (
                  <option key={rate} value={rate / 100}>第{index + 1}種（{rate}%）</option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-field">
            <input type="checkbox" name="twoTenthsEligible" defaultChecked={tax.twoTenthsEligible} />
            2割特例の適用要件を確認した
          </label>
        </fieldset>
        <div className="form-footer"><button className="dashboard-button" type="submit">年の前提を保存</button></div>
      </form>
    </section>
  );
}

function MonthlyPlans({ plans, lastClosedMonth, action }: { plans: MonthAmounts[]; lastClosedMonth: number; action: FormAction }) {
  return (
    <section className="dashboard-panel" id="monthly-plans" aria-labelledby="plans-heading">
      <header className="panel-heading">
        <h2 id="plans-heading">月ごとの見込み</h2>
        <p>残りの月に予定がある場合は、その月の着地額を入力します。空欄で自動見積もりに戻ります。</p>
      </header>
      <div className="plan-list">
        {months.filter((month) => month > lastClosedMonth).map((month) => {
          const plan = plans.find((entry) => entry.month === month);
          return (
            <details className="plan-edit" key={month}>
              <summary>{month}月{plan && <span className="plan-state">入力済み</span>}</summary>
              <form action={action} className="editable-form" aria-label={`${month}月の見込みを編集`}>
                <input type="hidden" name="month" value={month} />
                <div className="field-grid">
                  <AmountField name="sales" label="事業売上" value={plan?.sales} signed />
                  <AmountField name="expenses" label="事業経費" value={plan?.expenses} signed />
                  <AmountField name="salesTax" label="売上に係る消費税" value={plan?.salesTax} signed />
                  <AmountField name="deductiblePurchaseTax" label="控除対象の仕入税額" value={plan?.deductiblePurchaseTax} signed />
                </div>
                <div className="form-footer"><button className="dashboard-button secondary" type="submit">{month}月の見込みを保存</button></div>
              </form>
            </details>
          );
        })}
        {lastClosedMonth === 12 && <p className="form-hint">全ての月が締め済みです。</p>}
      </div>
    </section>
  );
}

const missingLabels: Record<keyof ForecastResult["missing"], string> = {
  sales: "事業売上",
  expenses: "事業経費",
  incomeTax: "所得税",
  incomeTaxSettlement: "追加納付・還付",
  donationLimit: "ふるさと納税の上限",
  donationRemaining: "ふるさと納税の残り枠",
  consumptionTax: "消費税",
};

function MissingInputs({ missing }: { missing: ForecastResult["missing"] }) {
  const keys = (Object.keys(missingLabels) as Array<keyof typeof missingLabels>).filter((key) => missing[key].length > 0);
  if (keys.length === 0) return null;

  return (
    <details className="monthly-detail missing-detail">
      <summary>予測に必要な入力を表示</summary>
      <ul>
        {keys.map((key) => <li key={key}><strong>{missingLabels[key]}</strong>　{missing[key].join("、")}</li>)}
      </ul>
    </details>
  );
}

export function ForecastDashboard({
  year, isDemo, forecast, tax, plans, lastClosedMonth, maxClosedMonth, lastClosedMonthSetting, connection, notice, actions, canLogout,
}: DashboardProps) {
  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <a href="#overview" className="dashboard-brand"><span className="brand-mark" aria-hidden="true">K</span>kageco support</a>
        <nav className="dashboard-nav" aria-label="ダッシュボード">
          <a href="#overview">年末の見込み</a>
          <a href="#monthly">月ごとの収支</a>
          <a href="#settings">予測の前提</a>
          <a href="#freee">freee連携</a>
        </nav>
        <div className="dashboard-sidebar-footer">
          <p>{year}年分</p>
          {canLogout && <form action={actions.logout}><button type="submit" className="sidebar-action">ログアウト</button></form>}
        </div>
      </aside>
      <main id="overview" className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <p className="dashboard-period">{year}年1月〜12月</p>
            <h1 className="dashboard-title">年間の収支と税金</h1>
            <p className="dashboard-intro">freee会計の実績と入力した前提から、年末の金額を見積もります。</p>
          </div>
          <div className="dashboard-actions">
            <form action={actions.setDemo}>
              <button className="dashboard-button secondary" type="submit" name="mode" value={isDemo ? "real" : "demo"}>
                {isDemo ? "実データに戻る" : "サンプルを見る"}
              </button>
            </form>
            <a className="dashboard-button" href="#settings">予測の前提を入力</a>
          </div>
        </header>
        {isDemo && <p className="dashboard-notice">サンプルデータを表示しています。入力した前提はサンプル表示に反映されます。</p>}
        {notice && <p className="dashboard-notice" role="status">{notice}</p>}
        <section aria-labelledby="summary-heading">
          <div className="section-heading">
            <h2 id="summary-heading">年末の見込み</h2>
            <p>締め済みの実績＋残りの月の見込み</p>
          </div>
          <div className="metrics-grid">
            <MetricCard title="年収・事業売上" amount={forecast.sales} caption="事業売上の年額" highlighted details={[
              { label: "給与・賞与", value: yen(forecast.salaryGross) },
              { label: "事業利益", value: yen(forecast.businessProfit) },
            ]} />
            <MetricCard title="支出" amount={forecast.expenses} caption="事業経費の年額" />
            <MetricCard title="ふるさと納税" amount={forecast.donationLimit} caption="寄附上限の目安" details={[
              { label: "残り枠", value: yen(forecast.donationRemaining) },
              { label: "寄附済み", value: yen(forecast.donationsPaid) },
              { label: "寄附予定", value: yen(forecast.donationsPlanned) },
            ]} />
            <MetricCard title="所得税" amount={forecast.incomeTax} caption="復興特別所得税を含む年税額" details={[
              { label: "精算見込み", value: settlement(forecast.incomeTaxSettlement) },
            ]} />
            <MetricCard title="消費税" amount={forecast.consumptionTax === null ? null : Math.abs(forecast.consumptionTax)} caption={forecast.consumptionTax != null && forecast.consumptionTax < 0 ? "消費税・地方消費税の還付" : "消費税・地方消費税の納付額"} />
          </div>
          <MissingInputs missing={forecast.missing} />
        </section>
        <div className="dashboard-overview">
          <MonthlyChart forecast={forecast} />
          <ConnectionPanel connection={connection} lastClosedMonth={lastClosedMonth} actions={actions} isDemo={isDemo} />
        </div>
        <section id="settings" className="dashboard-settings" aria-labelledby="settings-heading">
          <div className="section-heading"><h2 id="settings-heading">予測の前提</h2></div>
          <div className="settings-grid">
            <TaxForm tax={tax} lastClosedMonthSetting={lastClosedMonthSetting} maxClosedMonth={maxClosedMonth} action={actions.saveTax} />
            <MonthlyPlans plans={plans} lastClosedMonth={lastClosedMonth} action={actions.savePlan} />
          </div>
        </section>
      </main>
    </div>
  );
}
