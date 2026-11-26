import { MonthlyChart } from "@/components/monthly-chart";
import { summarizeAccountItems, type MonthlyChartAccountItems } from "@/lib/chart-account-items";
import { DEFAULT_TAX_FORM_AMOUNTS, type ForecastResult, type MonthAmounts, type MonthlyPlanMode, type TaxInputs } from "@/lib/forecast";

type FormAction = (formData: FormData) => Promise<void>;
type DashboardProps = {
  year: number;
  forecast: ForecastResult;
  accountItems: MonthlyChartAccountItems;
  tax: TaxInputs;
  plans: MonthAmounts[];
  monthlyPlanMode: MonthlyPlanMode;
  lastClosedMonth: number;
  maxClosedMonth: number;
  lastClosedMonthSetting: number | null;
  connection: {
    configured: boolean;
    connected: boolean;
    localSetup?: boolean;
    companyName: string | null;
    syncedAt: string | null;
    accountItemsNeedSync: boolean;
    status?: string | null;
  };
  notice?: string;
  actions: {
    startFreee: FormAction;
    disconnectFreee: FormAction;
    sync: FormAction;
    saveTax: FormAction;
    savePlan: FormAction;
    setPlanMode: FormAction;
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

function closedActualAmount(months: ForecastResult["months"], key: "sales" | "expenses"): number | null {
  if (months.length === 0) return null;
  let total = 0;
  for (const { actual } of months) {
    const amount = actual[key];
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

function AccountSummary({ rows, accountItems }: { rows: ForecastResult["months"]; accountItems: MonthlyChartAccountItems }) {
  const breakdown = summarizeAccountItems(rows, accountItems);
  if (rows.length === 0 || breakdown.every((group) => group === null)) return null;

  return (
    <details className="monthly-detail account-summary">
      <summary>勘定科目別の内訳</summary>
      <div className="account-summary-groups">
        {breakdown.map((group, index) => {
          const title = index === 0 ? "事業売上" : "事業経費";
          return (
            <section key={title}>
              <h3>{title}</h3>
              {group === null ? <p>未集計の月があります。</p> : (
                <dl className="account-summary-amounts">
                  {group.items.map(({ id, name, amount }) => <div key={id}><dt>{name}</dt><dd>{yen(amount)}</dd></div>)}
                  {group.manual !== null && <div><dt>手入力分（内訳なし）</dt><dd>{yen(group.manual)}</dd></div>}
                  {group.unavailable !== null && <div><dt>内訳未取得分</dt><dd>{yen(group.unavailable)}</dd></div>}
                  {group.items.length === 0 && group.manual === null && group.unavailable === null && <div><dt>合計</dt><dd>0円</dd></div>}
                </dl>
              )}
            </section>
          );
        })}
      </div>
    </details>
  );
}

function ActualSummary({ forecast, accountItems }: Pick<DashboardProps, "forecast" | "accountItems">) {
  const closedMonths = forecast.months.filter(({ closed }) => closed);
  const lastMonth = closedMonths.at(-1)?.month ?? 0;
  const sales = closedActualAmount(closedMonths, "sales");
  const expenses = closedActualAmount(closedMonths, "expenses");
  const profit = sales === null || expenses === null ? null : sales - expenses;
  const amounts = [
    { label: "事業売上", amount: sales },
    { label: "事業経費", amount: expenses },
    { label: "事業利益", amount: profit },
  ];

  return (
    <section className="actual-summary" aria-labelledby="actual-summary-heading">
      <div className="section-heading">
        <h2 id="actual-summary-heading">締め済みの実績</h2>
        <p>{lastMonth === 0 ? "締め済み月なし" : lastMonth === 1 ? "1月の事業収支" : `1月〜${lastMonth}月の事業収支`}</p>
      </div>
      <dl className="actual-totals">
        {amounts.map(({ label, amount }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={amount === null ? "unavailable" : undefined}>{amount === null ? "未集計" : yen(amount)}</dd>
          </div>
        ))}
      </dl>
      <AccountSummary rows={closedMonths} accountItems={accountItems} />
    </section>
  );
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

function ConnectionPanel({ connection, lastClosedMonth, actions }: Pick<DashboardProps, "connection" | "lastClosedMonth" | "actions">) {
  const { connected, configured, localSetup, syncedAt } = connection;
  const connectionLabel = connected ? "接続済み" : "未接続";
  const syncTime = syncedAt ? timeFormat.format(new Date(syncedAt)) : "未同期";

  return (
    <section className="dashboard-panel" id="freee" aria-labelledby="connection-heading">
      <header className="panel-heading">
        <h2 id="connection-heading">freee会計</h2>
      </header>
      <p className={`connection-state${connected ? "" : " inactive"}`}>{connectionLabel}</p>
      <dl className="connection-meta">
        <div><dt>事業所</dt><dd>{connection.companyName ?? "未選択"}</dd></div>
        <div><dt>最終同期</dt><dd>{syncTime}</dd></div>
        <div><dt>締め済み実績</dt><dd>{lastClosedMonth === 0 ? "未指定" : `${lastClosedMonth}月まで`}</dd></div>
      </dl>
      {syncedAt && !connected && <p className="connection-message">取り込み済みの実績で見込みを計算できます。</p>}
      {connected && !configured && (
        <p className="connection-message">
          {syncedAt ? "取り込み済みの実績で見込みを計算できます。再同期には" : "実績を同期するには"}
          {localSetup ? <a href="/freee/setup">接続設定</a> : "接続設定"}が必要です。
        </p>
      )}
      {connection.accountItemsNeedSync && <p className="connection-message">勘定科目別の内訳を表示するには、freeeから実績を再同期してください。</p>}
      {connection.status && <p className="connection-message">{connection.status}</p>}
      {(connected || configured || localSetup) && (
        <div className="connection-actions">
          {connected && configured && (
            <form action={actions.sync}>
              <button className="dashboard-button" type="submit">freeeから同期</button>
            </form>
          )}
          {connected ? (
            <form action={actions.disconnectFreee}>
              <button className={`dashboard-button${configured ? " secondary" : ""}`} type="submit">接続を解除</button>
            </form>
          ) : (
            <form action={actions.startFreee}>
              <button className="dashboard-button" type="submit">freeeに接続</button>
            </form>
          )}
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
        <p>入力した金額と締め済みの実績で年末の見込みを計算します。該当しない金額には0円を入力してください。</p>
      </header>
      <form action={action} className="editable-form">
        <fieldset className="form-group">
          <legend>収入と控除</legend>
          <div className="field-grid">
            <AmountField name="salaryGross" label="給与・賞与の年額" value={tax.salaryGross} />
            <AmountField name="blueDeduction" label="青色申告特別控除" value={tax.blueDeduction ?? DEFAULT_TAX_FORM_AMOUNTS.blueDeduction} />
            <AmountField name="socialInsurance" label="社会保険料控除" value={tax.socialInsurance} />
          </div>
        </fieldset>
        <fieldset className="form-group">
          <legend>ふるさと納税</legend>
          <div className="field-grid">
            <AmountField name="donationsPaid" label="寄附済額" value={tax.donationsPaid} />
            <label className="form-field">
              <span>寄附控除の手続き</span>
              <select name="donationMethod" defaultValue={tax.donationMethod ?? ""}>
                <option value="">未選択</option>
                <option value="return">確定申告</option>
                <option value="one-stop">ワンストップ特例</option>
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset className="form-group consumption-tax-group">
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
            <label className="form-field consumption-tax-rate">
              <span>簡易課税のみなし仕入率</span>
              <select name="simplifiedPurchaseRate" defaultValue={tax.simplifiedPurchaseRate ?? ""}>
                <option value="">未選択</option>
                {[90, 80, 70, 60, 50, 40].map((rate, index) => (
                  <option key={rate} value={rate / 100}>第{index + 1}種（{rate}%）</option>
                ))}
              </select>
            </label>
          </div>
          <label className="check-field consumption-tax-eligibility">
            <input type="checkbox" name="twoTenthsEligible" defaultChecked={tax.twoTenthsEligible} />
            2割特例の適用要件を確認した
          </label>
        </fieldset>
        {/* The native disclosure can open before React hydrates it. */}
        <details className="tax-form-details" suppressHydrationWarning>
          <summary>詳細設定</summary>
          <div className="tax-form-details-content">
            <p className="form-hint">所得税・住民税のその他の所得控除、所得税の税額控除、寄附予定額は0円が初期値です。</p>
            <fieldset className="form-group">
              <legend>集計期間</legend>
              <div className="field-grid">
                <label className="form-field">
                  <span>締め済みの最終月</span>
                  <select name="lastClosedMonth" defaultValue={lastClosedMonthSetting ?? ""}>
                    <option value="">自動（同期済みの最終月）</option>
                    <option value={0}>締め済みの月なし</option>
                    {months.slice(0, maxClosedMonth).map((month) => <option key={month} value={month}>{month}月</option>)}
                  </select>
                </label>
              </div>
            </fieldset>
            <fieldset className="form-group">
              <legend>所得税の控除と精算</legend>
              <div className="field-grid">
                <AmountField name="otherIncomeDeductions" label="その他の所得控除" value={tax.otherIncomeDeductions ?? DEFAULT_TAX_FORM_AMOUNTS.otherIncomeDeductions} />
                <AmountField name="incomeTaxCredit" label="所得税の税額控除" value={tax.incomeTaxCredit ?? DEFAULT_TAX_FORM_AMOUNTS.incomeTaxCredit} />
                <AmountField name="withheldIncomeTax" label="源泉徴収税額" value={tax.withheldIncomeTax} />
                <AmountField name="prepaidIncomeTax" label="所得税の予定納税額" value={tax.prepaidIncomeTax} />
              </div>
              <p className="form-hint">その他の所得控除には、所得税の扶養控除などを入力します。</p>
            </fieldset>
            <fieldset className="form-group">
              <legend>ふるさと納税と住民税</legend>
              <div className="field-grid">
                <AmountField name="donationsPlanned" label="今後の寄附予定額" value={tax.donationsPlanned ?? DEFAULT_TAX_FORM_AMOUNTS.donationsPlanned} />
                <AmountField name="otherResidentDeductions" label="住民税のその他の所得控除" value={tax.otherResidentDeductions ?? DEFAULT_TAX_FORM_AMOUNTS.otherResidentDeductions} />
                <AmountField name="residentPersonalDeductionDifference" label="基礎控除以外の人的控除差" value={tax.residentPersonalDeductionDifference} />
                <AmountField name="residentAdjustmentDeduction" label="住民税の調整控除（任意）" value={tax.residentAdjustmentDeduction} />
              </div>
              <p className="form-hint">控除の入力には給与明細や住民税の通知書を参照できます。</p>
            </fieldset>
          </div>
        </details>
        <div className="form-footer">
          <p className="form-hint">入力はサーバー起動中だけ保持します。</p>
          <button className="dashboard-button" type="submit">年末の見込みを計算</button>
        </div>
      </form>
    </section>
  );
}

function MonthlyPlans({ plans, monthlyPlanMode, forecast, actions }: Pick<DashboardProps, "plans" | "monthlyPlanMode" | "forecast"> & {
  actions: Pick<DashboardProps["actions"], "savePlan" | "setPlanMode">;
}) {
  const remainingMonths = forecast.months.filter(({ closed }) => !closed);
  const trend = monthlyPlanMode === "trend";

  return (
    <section className="dashboard-panel" id="monthly-plans" aria-labelledby="plans-heading">
      <header className="panel-heading">
        <h2 id="plans-heading">月ごとの見込み</h2>
        <p>{remainingMonths.length === 0
          ? "すべての月が締め済みです。"
          : trend
            ? "締め済みの実績から、直近最大3か月の平均で見積もります。"
            : "月ごとの着地額を入力します。空欄の項目は推移から見積もります。"}</p>
      </header>
      {remainingMonths.length > 0 && (
        <>
          <form action={actions.setPlanMode} className="plan-mode" aria-label="見込みの入力方法">
            <button className={`dashboard-button${trend ? "" : " secondary"}`} type="submit" name="monthlyPlanMode" value="trend" aria-pressed={trend}>推移モード</button>
            <button className={`dashboard-button${trend ? " secondary" : ""}`} type="submit" name="monthlyPlanMode" value="manual" aria-pressed={!trend}>手入力</button>
          </form>
          {trend ? (
            <div className="table-scroll">
              <table className="month-table" aria-label="推移モードの月別の見込み">
                <thead>
                  <tr>
                    <th scope="col">月</th>
                    <th scope="col" className="numeric-cell">事業売上</th>
                    <th scope="col" className="numeric-cell">事業経費</th>
                  </tr>
                </thead>
                <tbody>
                  {remainingMonths.map(({ month, forecast: amounts }) => (
                    <tr key={month}>
                      <th scope="row">{month}月</th>
                      <td className="numeric-cell">{yen(amounts.sales)}</td>
                      <td className="numeric-cell">{yen(amounts.expenses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="plan-list">
              {remainingMonths.map(({ month }) => {
                const plan = plans.find((entry) => entry.month === month);
                return (
                  <details className="plan-edit" key={month}>
                    <summary>{month}月{plan && <span className="plan-state">入力済み</span>}</summary>
                    <form action={actions.savePlan} className="editable-form" aria-label={`${month}月の見込みを編集`}>
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
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ForecastGuidance({ missing, synced }: { missing: ForecastResult["missing"]; synced: boolean }) {
  const { incomeTaxSettlement, ...annualMissing } = missing;
  const reasons = [...new Set(Object.values(annualMissing).flat())];
  const needsMonthlyAmounts = reasons.some((reason) => reason.endsWith("月）"));
  const needsTaxInputs = reasons.some((reason) => !reason.endsWith("月）"));
  const settlementReasons = incomeTaxSettlement.filter((reason) => !missing.incomeTax.includes(reason));
  if (synced && reasons.length === 0 && settlementReasons.length === 0) return null;

  return (
    <div className="forecast-guidance">
      {!synced && <p>事業の実績は<a href="#freee">freee連携</a>から取り込めます。</p>}
      {reasons.length > 0 && (
        <>
          <p><strong>未算出の理由</strong>　{reasons.join("、")}</p>
          {needsMonthlyAmounts && <p>対象月の実績は<a href="#freee">freee連携</a>で確認できます。未締め月は<a href="#monthly-plans">月ごとの見込み</a>で手入力できます。</p>}
          {needsTaxInputs && <p><a href="#settings">予測の前提</a>を入力し、「年末の見込みを計算」を押すと反映されます。</p>}
        </>
      )}
      {settlementReasons.length > 0 && (
        <p><strong>追加納付・還付（任意）</strong>　{settlementReasons.join("、")}は<a href="#settings">年の前提と税金</a>の詳細設定で入力できます。</p>
      )}
    </div>
  );
}

export function ForecastDashboard({
  year, forecast, accountItems, tax, plans, monthlyPlanMode, lastClosedMonth, maxClosedMonth, lastClosedMonthSetting, connection, notice, actions, canLogout,
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
          <p className="dashboard-period">{year}年1月〜12月</p>
          <h1 className="dashboard-title">年間の収支と税金</h1>
          <p className="dashboard-intro">{connection.syncedAt
            ? "取り込み済みの実績を使います。給与・控除などを入力したら「年末の見込みを計算」を押してください。"
            : "freeeから実績を同期し、給与・控除などを入力して「年末の見込みを計算」を押してください。"}</p>
        </header>
        {notice && <p className="dashboard-notice" role="status">{notice}</p>}
        <ActualSummary forecast={forecast} accountItems={accountItems} />
        <section aria-labelledby="summary-heading">
          <div className="section-heading">
            <h2 id="summary-heading">年末の見込み</h2>
            <p>締め済みの実績と未締め月の見込みから試算</p>
          </div>
          <div className="metrics-grid">
            <MetricCard title="年収・事業売上" amount={forecast.sales} caption="事業売上の年額" highlighted details={[
              { label: "給与・賞与", value: yen(forecast.salaryGross) },
              { label: "事業利益", value: yen(forecast.businessProfit) },
            ]} />
            <MetricCard title="支出" amount={forecast.expenses} caption="事業経費の年額" />
            <MetricCard title="ふるさと納税" amount={forecast.donationLimit} caption="寄附上限の目安" details={[
              { label: "残り枠", value: yen(forecast.donationRemaining) },
              { label: "寄附予定", value: yen(forecast.donationsPlanned) },
            ]} />
            <MetricCard title="所得税" amount={forecast.incomeTax} caption="復興特別所得税を含む年税額" details={[
              { label: "追加納付・還付", value: settlement(forecast.incomeTaxSettlement) },
            ]} />
            <MetricCard title="消費税" amount={forecast.consumptionTax === null ? null : Math.abs(forecast.consumptionTax)} caption={forecast.consumptionTax != null && forecast.consumptionTax < 0 ? "消費税・地方消費税の還付" : "消費税・地方消費税の納付額"} />
          </div>
          <AccountSummary rows={forecast.months} accountItems={accountItems} />
          <ForecastGuidance missing={forecast.missing} synced={connection.syncedAt !== null} />
        </section>
        <div className="dashboard-overview">
          <MonthlyChart rows={forecast.months} accountItems={accountItems} />
          <ConnectionPanel connection={connection} lastClosedMonth={lastClosedMonth} actions={actions} />
        </div>
        <section id="settings" className="dashboard-settings" aria-labelledby="settings-heading">
          <div className="section-heading"><h2 id="settings-heading">予測の前提</h2></div>
          <div className="settings-grid">
            <TaxForm tax={tax} lastClosedMonthSetting={lastClosedMonthSetting} maxClosedMonth={maxClosedMonth} action={actions.saveTax} />
            <MonthlyPlans plans={plans} monthlyPlanMode={monthlyPlanMode} forecast={forecast} actions={actions} />
          </div>
        </section>
      </main>
    </div>
  );
}
