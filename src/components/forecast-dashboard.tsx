import type { CSSProperties, ReactNode } from "react";
import { MonthlyChart } from "@/components/monthly-chart";
import { APP_NAME } from "@/lib/app-name";
import { getAccountItemColors, summarizeAccountItems, type AccountItemColors, type MonthlyChartAccountItems } from "@/lib/chart-account-items";
import { BEPPU_RESIDENT_TAX, DEFAULT_TAX_FORM_AMOUNTS, type ForecastResult, type MonthAmounts, type MonthlyPlanMode, type TaxInputs } from "@/lib/forecast";

type FormAction = (formData: FormData) => Promise<void>;
type DashboardProps = {
  year: number;
  forecast: ForecastResult;
  accountItems: MonthlyChartAccountItems;
  tax: TaxInputs;
  plans: MonthAmounts[];
  monthlyPlanMode: MonthlyPlanMode;
  lastClosedSalesMonth: number;
  lastClosedExpenseMonth: number;
  defaultClosedMonth: number;
  maxClosedMonth: number;
  lastClosedMonthSetting: number | null;
  lastClosedSalesMonthSetting: number | null;
  lastClosedExpenseMonthSetting: number | null;
  connection: {
    configured: boolean;
    connected: boolean;
    canSync: boolean;
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
    saveClosedMonth: FormAction;
    saveTax: FormAction;
    savePlan: FormAction;
    setPlanMode: FormAction;
    logout: FormAction;
  };
};

const months = Array.from({ length: 12 }, (_, index) => index + 1);
const consumptionMethodLabels: Record<NonNullable<TaxInputs["consumptionMethod"]>, string> = {
  exempt: "免税",
  general: "一般課税",
  simplified: "簡易課税",
  "two-tenths": "2割特例",
};
const yenFormat = new Intl.NumberFormat("ja-JP");
const percentFormat = new Intl.NumberFormat("ja-JP", { style: "percent", maximumFractionDigits: 3 });
const timeFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  dateStyle: "short",
  timeStyle: "short",
});

function yen(amount: number | null | undefined) {
  return amount == null ? "未算出" : `${yenFormat.format(amount === 0 ? 0 : amount)}円`;
}

function percent(rate: number) {
  return percentFormat.format(rate / 100);
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

function closedPeriodCaption(monthCount: number) {
  if (monthCount === 0) return "締め済み月なし";
  return monthCount === 1 ? "1月の締め済み実績" : `1月〜${monthCount}月の締め済み実績`;
}

function closedMonthLabel(month: number) {
  return month === 0 ? "締め済み月なし" : `${month}月まで`;
}

type AccountBreakdown = ReturnType<typeof summarizeAccountItems>["sales"];

function AccountBreakdownList({ breakdown, itemColors, needsSync }: {
  breakdown: AccountBreakdown;
  itemColors: AccountItemColors;
  needsSync: boolean;
}) {
  if (!breakdown) return null;
  const { items, manual, unavailable, hasMissingMonths } = breakdown;
  const previewCount = 4;
  const accountRows = items.map(({ id, name, amount }) => (
    <div key={id}>
      <dt><span className="legend-swatch" style={{ "--bar-color": itemColors.get(id)?.color } as CSSProperties} aria-hidden="true" />{name}</dt>
      <dd>{yen(amount)}</dd>
    </div>
  ));
  const remainingCount = Math.max(0, accountRows.length - previewCount);

  return (
    <div className="account-breakdown">
      <h4>勘定科目</h4>
      {hasMissingMonths && <p>集計できた月の内訳</p>}
      {items.length === 0 && manual === null && unavailable === null ? <p>該当する勘定科目なし</p> : (
        <dl className="account-breakdown-amounts">
          {accountRows.slice(0, previewCount)}
          {manual !== null && <div><dt>手入力分（科目なし）</dt><dd>{yen(manual)}</dd></div>}
          {unavailable !== null && <div><dt>科目未取得分</dt><dd>{yen(unavailable)}</dd></div>}
        </dl>
      )}
      {remainingCount > 0 && (
        <details className="account-breakdown-more" suppressHydrationWarning>
          <summary>残り{remainingCount}科目を表示</summary>
          <dl className="account-breakdown-amounts">{accountRows.slice(previewCount)}</dl>
        </details>
      )}
      {unavailable !== null && needsSync && <p><a href="#freee">freee連携から内訳を取得</a></p>}
    </div>
  );
}

function ActualSummary({ forecast, accountItems, itemColors, needsSync }: Pick<DashboardProps, "forecast" | "accountItems"> & {
  itemColors: AccountItemColors;
  needsSync: boolean;
}) {
  const closedMonths = forecast.months.filter(({ closed }) => closed);
  const salesMonths = forecast.months.filter(({ closedByAmount }) => closedByAmount.sales);
  const expenseMonths = forecast.months.filter(({ closedByAmount }) => closedByAmount.expenses);
  const samePeriod = salesMonths.length === expenseMonths.length;
  const sales = closedActualAmount(salesMonths, "sales");
  const expenses = closedActualAmount(expenseMonths, "expenses");
  const incomeSales = closedMonths.length === salesMonths.length ? sales : closedActualAmount(closedMonths, "sales");
  const incomeExpenses = closedMonths.length === expenseMonths.length ? expenses : closedActualAmount(closedMonths, "expenses");
  const profit = incomeSales === null || incomeExpenses === null ? null : incomeSales - incomeExpenses;
  const salesPeriodBreakdown = summarizeAccountItems(salesMonths, accountItems);
  const expenseBreakdown = samePeriod ? salesPeriodBreakdown.expenses : summarizeAccountItems(expenseMonths, accountItems).expenses;
  const actualYen = (amount: number | null) => amount === null ? "未集計" : yen(amount);

  return (
    <section aria-labelledby="actual-summary-heading">
      <div className="section-heading">
        <div className="section-title">
          <h2 id="actual-summary-heading">締め済みの実績</h2>
          {samePeriod && <p>{closedPeriodCaption(closedMonths.length)}</p>}
        </div>
      </div>
      <div className="financial-grid">
        <MetricCard title="事業売上" amount={sales} unavailableLabel="未集計"
          caption={samePeriod ? undefined : closedPeriodCaption(salesMonths.length)}>
          <AccountBreakdownList breakdown={salesPeriodBreakdown.sales} itemColors={itemColors} needsSync={needsSync} />
        </MetricCard>
        <MetricCard title="支出（事業経費）" amount={expenses} unavailableLabel="未集計"
          caption={samePeriod ? undefined : closedPeriodCaption(expenseMonths.length)}>
          <AccountBreakdownList breakdown={expenseBreakdown} itemColors={itemColors} needsSync={needsSync} />
        </MetricCard>
        <MetricCard className="income-card" title="所得（実績）" amount={profit}
          caption="締め済み月の事業所得（青色申告特別控除前）" unavailableLabel="未集計">
          <CalculationSteps steps={[{
            label: "事業所得の計算式",
            expression: `事業売上 ${actualYen(incomeSales)} − 事業経費 ${actualYen(incomeExpenses)} ＝ ${actualYen(profit)}`,
          }]} />
          {!samePeriod && <p className="metric-caption">所得は売上・支出がともに締め済みの期間で計算します（{closedPeriodCaption(closedMonths.length)}）。</p>}
          <p className="metric-caption">年額で入力した給与・賞与と青色申告特別控除は、年末の見込みに反映します。</p>
        </MetricCard>
      </div>
    </section>
  );
}

function MetricCard({
  title,
  amount,
  caption,
  children,
  details,
  footer,
  className,
  unavailableLabel = "未算出",
}: {
  title: string;
  amount: number | null;
  caption?: string;
  children?: ReactNode;
  details?: Array<{ label: string; value: string }>;
  footer?: ReactNode;
  className?: string;
  unavailableLabel?: string;
}) {
  return (
    <article className={className ? `metric-card ${className}` : "metric-card"}>
      <h3>{title}</h3>
      <p className={`metric-amount${amount === null ? " unavailable" : ""}`}>
        {amount === null ? unavailableLabel : <>{yenFormat.format(amount)}<span className="amount-unit">円</span></>}
      </p>
      {caption && <p className="metric-caption">{caption}</p>}
      {children}
      {details && (
        <dl className="metric-detail">
          {details.map(({ label, value }) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      )}
      {footer}
    </article>
  );
}

type CalculationStep = { label: string; expression: string };

function CalculationSteps({ steps }: { steps: CalculationStep[] }) {
  return (
    <dl className="calculation-steps">
      {steps.map(({ label, expression }) => (
        <div key={label}><dt>{label}</dt><dd>{expression}</dd></div>
      ))}
    </dl>
  );
}

function ForecastAmountCalculation({ forecast, amountKey }: Pick<DashboardProps, "forecast"> & { amountKey: "sales" | "expenses" }) {
  const closed = forecast.months.filter(({ closedByAmount }) => closedByAmount[amountKey]);
  const remaining = forecast.months.filter(({ closedByAmount }) => !closedByAmount[amountKey]);
  const lastClosedMonth = closed.at(-1)?.month ?? 0;
  const actualTotal = closed.length ? closedActualAmount(closed, amountKey) : 0;
  const missingActuals = closed.filter(({ actual }) => actual[amountKey] === null);
  const steps = [{
    label: closed.length ? `${closedPeriodCaption(lastClosedMonth)}（freee）` : "締め済み実績（freee）",
    expression: actualTotal === null ? `未集計（${missingActuals.map(({ month }) => `${month}月`).join("・")}）`
      : closed.length ? yen(actualTotal) : "0円（締め済み月なし）",
  }];

  const { method, amount, included } = forecast.trend[amountKey];
  const usesTrend = remaining.some(({ sources }) => sources[amountKey] === "average");
  if (usesTrend && method !== "unavailable") {
    const operands = included.map(({ month, amount: actual }) => `${month}月 ${yen(actual)}`).join(" ＋ ");
    const expression = included.length > 1 ? `（${operands}） ÷ ${included.length} → ${yen(amount)}` : operands;
    steps.push({
      label: included.length > 1 ? "締め月までの月平均（1円単位に丸め）" : "締め月までの月平均",
      expression,
    });
  } else if (method === "unavailable" && remaining.some(({ sources }) => sources[amountKey] === "missing")) {
    steps.push({ label: "見込みの基準額", expression: "未算出（利用できる締め済み実績なし）" });
  }

  for (const { month, forecast: amounts, sources } of remaining) {
    const source = sources[amountKey];
    const sourceLabel = source === "average" ? "（月平均）" : source === "plan" ? "（手入力）" : "";
    steps.push({ label: `${month}月の見込み${sourceLabel}`, expression: yen(amounts[amountKey]) });
  }

  const remainingTotal = remaining.reduce<number | null>((total, row) => {
    const amount = row.forecast[amountKey];
    return total === null || amount === null ? null : total + amount;
  }, 0);
  const actualTerm = `${yen(actualTotal)}（締め済み実績）`;
  const terms = remaining.length ? `${actualTerm} ＋ ${yen(remainingTotal)}（未締め月の見込み）` : actualTerm;
  const annualTotal = forecast[amountKey];
  steps.push({
    label: "年末の見込み",
    expression: `${terms} ${annualTotal === null ? "→" : "＝"} ${yen(annualTotal)}`,
  });

  return (
    <details className="forecast-calculation" suppressHydrationWarning>
      <summary>見込みの計算式</summary>
      <CalculationSteps steps={steps} />
    </details>
  );
}

function IncomeForecastCard({ forecast }: Pick<DashboardProps, "forecast">) {
  const { businessIncome, appliedBlueDeduction, salaryIncome, salaryDeduction, totalIncome, missing } = forecast.incomeForecast;
  const steps = [
    {
      label: "事業利益",
      expression: `事業売上 ${yen(forecast.sales)} − 事業経費 ${yen(forecast.expenses)} ＝ ${yen(forecast.businessProfit)}`,
    },
    {
      label: "事業所得",
      expression: `事業利益 ${yen(forecast.businessProfit)} − 青色申告特別控除 ${yen(appliedBlueDeduction)} ＝ ${yen(businessIncome)}`,
    },
    {
      label: "給与所得",
      expression: `給与・賞与の年額 ${yen(forecast.salaryGross)} − 速算表による差引額 ${yen(salaryDeduction)} ＝ ${yen(salaryIncome)}`,
    },
    {
      label: "合計所得（下限0円）",
      expression: `事業所得 ${yen(businessIncome)} ＋ 給与所得 ${yen(salaryIncome)} → ${yen(totalIncome)}`,
    },
  ];

  return (
    <MetricCard className="income-card" title="所得（見込み）" amount={totalIncome}
      caption="税額試算に使う合計所得（基礎控除・社会保険料控除などを引く前）">
      <CalculationSteps steps={steps} />
      <p className="metric-caption">青色申告特別控除は事業利益が黒字の場合に適用し、その利益を上限とします。</p>
      {missing.length > 0 && <p className="metric-caption">計算には {missing.join("、")} の確認が必要です。</p>}
    </MetricCard>
  );
}

function TaxCalculation({ steps, missing }: { steps: CalculationStep[] | null; missing: string[] }) {
  return (
    <details className="tax-calculation" suppressHydrationWarning>
      <summary>{steps ? "計算式を表示" : "未算出の理由"}</summary>
      {steps ? (
        <CalculationSteps steps={steps} />
      ) : (
        <ul className="tax-calculation-missing">
          {missing.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </details>
  );
}

function donationLimitSteps(details: ForecastResult["donationLimitDetails"], amount: number | null): CalculationStep[] | null {
  if (!details) return null;

  const { cityRate, prefectureRate, singleIncomeExemptionLimit, adjustmentTaxableThreshold, adjustmentMinimumBase,
    adjustmentRate, specialCreditCapRate, donationIncomeCapRate, selfContribution } = BEPPU_RESIDENT_TAX;
  const steps = [
    {
      label: "住民税の課税所得（下限0円、1,000円未満切り捨て）",
      expression: `${yen(details.totalIncome)}（合計所得） − ${yen(details.basicDeduction)}（基礎控除） − ${yen(details.socialInsurance)}（社会保険料控除） − ${yen(details.otherDeductions)}（その他の所得控除） → ${yen(details.taxableIncome)}`,
    },
  ];
  if (details.incomeExempt) {
    return [...steps, {
      label: "所得割の非課税基準（扶養親族等なし）",
      expression: `${yen(details.totalIncome)} ≦ ${yen(singleIncomeExemptionLimit)} のため、所得割と寄附上限の目安は0円`,
    }];
  }

  const adjustmentSteps = details.adjustmentBase === null ? [
    { label: "調整控除", expression: yen(details.adjustmentDeduction) },
  ] : [
    {
      label: "調整控除の算定基礎",
      expression: details.taxableIncome <= adjustmentTaxableThreshold
        ? `${yen(details.personalDeductionDifference)}（人的控除差）と ${yen(details.taxableIncome)}（課税所得）の少ない方 → ${yen(details.adjustmentBase)}`
        : `（${yen(details.personalDeductionDifference)}（人的控除差） − （${yen(details.taxableIncome)} − ${yen(adjustmentTaxableThreshold)}））と ${yen(adjustmentMinimumBase)} の多い方 → ${yen(details.adjustmentBase)}`,
    },
    {
      label: "調整控除",
      expression: `${yen(details.adjustmentBase)} × ${percent(adjustmentRate)} → ${yen(details.adjustmentDeduction)}`,
    },
  ];

  steps.push(
    {
      label: "別府市の市民税所得割",
      expression: `${yen(details.taxableIncome)} × ${percent(cityRate)} ＝ ${yen(details.cityTax)}`,
    },
    {
      label: "大分県の県民税所得割",
      expression: `${yen(details.taxableIncome)} × ${percent(prefectureRate)} ＝ ${yen(details.prefectureTax)}`,
    },
    ...adjustmentSteps,
    {
      label: "市県民税の所得割（調整控除後）",
      expression: `${yen(details.cityTax)} ＋ ${yen(details.prefectureTax)} − ${yen(details.adjustmentDeduction)} → ${yen(details.incomeLevy)}`,
    },
  );
  if (details.incomeLevy === 0) {
    return [...steps, { label: "寄附上限の目安", expression: "所得割が0円のため 0円" }];
  }

  return [...steps,
    {
      label: "ふるさと納税の特例控除上限",
      expression: `${yen(details.incomeLevy)} × ${percent(specialCreditCapRate)} ＝ ${yen(details.specialCreditCap)}`,
    },
    {
      label: "ふるさと納税の特例控除割合",
      expression: `100% − （${percent(cityRate)} ＋ ${percent(prefectureRate)}） − ${percent(details.nationalIncomeRateForDonation)}（復興特別所得税を含む限界税率） ＝ ${percent(details.specialCreditRate)}`,
    },
    {
      label: "所得割から計算した寄附上限（1円未満切り捨て）",
      expression: `${yen(details.specialCreditCap)} ÷ ${percent(details.specialCreditRate)} ＋ ${yen(selfContribution)}（自己負担額） → ${yen(details.estimatedLimit)}`,
    },
    {
      label: "住民税の控除対象となる寄附額の上限",
      expression: `${yen(details.totalIncome)} × ${percent(donationIncomeCapRate)} → ${yen(details.donationIncomeCap)}`,
    },
    {
      label: "寄附上限の目安",
      expression: `${yen(details.estimatedLimit)} と ${yen(details.donationIncomeCap)} の少ない方 → ${yen(amount)}`,
    },
  ];
}

function DonationLimitCard({ forecast, year }: Pick<DashboardProps, "forecast" | "year">) {
  const details = forecast.donationLimitDetails;
  const { cityRate, prefectureRate } = BEPPU_RESIDENT_TAX;
  return (
    <MetricCard title="ふるさと納税" amount={forecast.donationLimit} caption={`${year + 1}年度の市県民税に基づく寄附上限の目安`} details={[
      { label: "住民税の課税所得", value: yen(details?.taxableIncome) },
      { label: "別府市の市民税率（所得割）", value: percent(cityRate) },
      { label: "大分県の県民税率（所得割）", value: percent(prefectureRate) },
      { label: "市県民税の所得割（調整控除後）", value: yen(details?.incomeLevy) },
      { label: "残り枠", value: yen(forecast.donationRemaining) },
      { label: "寄附予定", value: yen(forecast.donationsPlanned) },
    ]} footer={(
      <>
        <p className="metric-caption">寄附上限は所得割で試算します。非課税判定は扶養親族等がいない場合の基準を使います。</p>
        <TaxCalculation steps={donationLimitSteps(details, forecast.donationLimit)} missing={forecast.missing.donationLimit} />
      </>
    )} />
  );
}

function IncomeTaxCard({ forecast }: Pick<DashboardProps, "forecast">) {
  const details = forecast.incomeTaxDetails;
  const steps = details && [
    {
      label: "課税所得（下限0円、1,000円未満切り捨て）",
      expression: `${yen(details.totalIncome)}（合計所得） − ${yen(details.basicDeduction)}（基礎控除） − ${yen(details.socialInsurance)}（社会保険料控除） − ${yen(details.otherIncomeDeductions)}（その他の所得控除） − ${yen(details.donationDeduction)}（寄附金控除） → ${yen(details.taxableIncome)}`,
    },
    {
      label: "所得税（下限0円）",
      expression: `${yen(details.taxableIncome)} × ${details.rate}% − ${yen(details.bracketDeduction)}（速算控除額） − ${yen(details.taxCredit)}（税額控除） → ${yen(details.baseTax)}`,
    },
    {
      label: "復興特別所得税（1円未満切り捨て）",
      expression: `${yen(details.baseTax)} × ${details.reconstructionRate}% → ${yen(details.reconstructionTax)}`,
    },
    {
      label: "年間の所得税・復興特別所得税",
      expression: `${yen(details.baseTax)} ＋ ${yen(details.reconstructionTax)} ＝ ${yen(forecast.incomeTax)}`,
    },
  ];

  return (
    <MetricCard title="所得税" amount={forecast.incomeTax} caption="復興特別所得税を含む年税額" details={[
      { label: "課税所得", value: yen(details?.taxableIncome) },
      { label: "所得税率（速算表）", value: details ? `${details.rate}%` : "未確認" },
      { label: "復興特別所得税率", value: details ? `${details.reconstructionRate}%` : "未確認" },
      { label: "追加納付・還付", value: settlement(forecast.incomeTaxSettlement) },
    ]} footer={<TaxCalculation steps={steps} missing={forecast.missing.incomeTax} />} />
  );
}

function consumptionTaxSteps(details: ForecastResult["consumptionTaxDetails"]): CalculationStep[] | null {
  if (!details) return null;
  if (details.method === "exempt") return [{ label: "消費税の納付額", expression: "免税のため 0円" }];

  const { salesTax, nationalSalesShare, nationalSalesTax, nationalPurchaseCredit, nationalTax, localTax,
    localTaxNumerator, localTaxDenominator } = details;
  const isRefund = nationalTax < 0;
  const salesTaxInput = `${yen(salesTax)}（売上税額の国・地方合計）`;
  const salesTaxBase = salesTax < 0 ? `最大値（0円、${salesTaxInput}）` : salesTaxInput;
  const purchaseCredit = nationalPurchaseCredit < 0 ? `（${yen(nationalPurchaseCredit)}）` : yen(nationalPurchaseCredit);
  const purchaseCreditStep = details.method === "general" ? {
    label: "仕入税額控除の国税分（1円未満切り下げ）",
    expression: `${yen(details.purchaseTax)} × ${nationalSalesShare}% → ${yen(nationalPurchaseCredit)}`,
  } : {
    label: "仕入税額控除の国税分（1円未満切り捨て）",
    expression: `${yen(nationalSalesTax)} × ${details.deemedPurchaseRate}% → ${yen(nationalPurchaseCredit)}`,
  };

  return [
    {
      label: "売上税額の国税分（1円未満切り捨て）",
      expression: `${salesTaxBase} × ${nationalSalesShare}% → ${yen(nationalSalesTax)}`,
    },
    purchaseCreditStep,
    {
      label: isRefund ? "国税の消費税（還付分）" : "国税の消費税（100円未満切り捨て）",
      expression: `${yen(nationalSalesTax)} − ${purchaseCredit} ${isRefund ? "＝" : "→"} ${yen(nationalTax)}`,
    },
    {
      label: isRefund ? "地方消費税（1円未満切り捨て）" : "地方消費税（100円未満切り捨て）",
      expression: `${yen(nationalTax)} × ${localTaxNumerator} ÷ ${localTaxDenominator} → ${yen(localTax)}`,
    },
    {
      label: isRefund ? "消費税・地方消費税の還付額" : "消費税・地方消費税の納付額",
      expression: `${yen(Math.abs(nationalTax))} ＋ ${yen(Math.abs(localTax))} ＝ ${yen(Math.abs(nationalTax + localTax))}`,
    },
  ];
}

function ConsumptionTaxCard({ forecast }: Pick<DashboardProps, "forecast">) {
  const details = forecast.consumptionTaxDetails;
  const amount = forecast.consumptionTax;
  const taxableSales = forecast.taxableSalesByRate;
  const salesByRate = Object.entries(taxableSales ?? {})
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .sort(([left], [right]) => Number(right) - Number(left));
  const totalTaxableSales = salesByRate.reduce((total, [, value]) => total + value, 0);

  return (
    <MetricCard title="消費税" amount={amount === null ? null : Math.abs(amount)}
      caption={amount !== null && amount < 0 ? "消費税・地方消費税の還付" : "消費税・地方消費税の納付額"}
      details={[
        { label: details?.method === "exempt" ? "帳簿上の課税売上高（税抜）" : "課税売上高（税抜）", value: taxableSales === null ? "未集計" : yen(totalTaxableSales) },
        ...(salesByRate.length
          ? salesByRate.map(([rate, value]) => ({
            label: rate === "0" ? "輸出免税（0%）の売上" : `税率${rate}%の課税売上`,
            value: yen(value),
          }))
          : [{ label: "帳簿上の消費税率", value: taxableSales === null ? "未確認" : "該当なし" }]),
        ...(details ? [{ label: "申告方式", value: consumptionMethodLabels[details.method] }] : []),
        ...(details?.method === "simplified" || details?.method === "two-tenths" ? [{
          label: details.method === "simplified" ? "みなし仕入率" : "2割特例の控除割合",
          value: `${details.deemedPurchaseRate}%`,
        }] : []),
      ]}
      footer={(
        <>
          {taxableSales === null && <p className="metric-caption">freeeの税区分が未取得の月や、売上・売上税額を手入力した未締め月がある場合は未集計です。</p>}
          <TaxCalculation steps={consumptionTaxSteps(details)} missing={forecast.missing.consumptionTax} />
        </>
      )}
    />
  );
}

function ConnectionPanel({ connection, lastClosedSalesMonth, lastClosedExpenseMonth, actions }: Pick<DashboardProps,
  "connection" | "lastClosedSalesMonth" | "lastClosedExpenseMonth" | "actions">) {
  const { connected, configured, syncedAt, canSync } = connection;
  const connectionLabel = connected ? "接続済み" : "未接続";
  const syncTime = syncedAt ? timeFormat.format(new Date(syncedAt)) : "未同期";
  const needsLogin = connected && configured && !canSync;
  const needsSetup = connected && !configured && !canSync;
  const hasMessages = needsLogin || needsSetup || connection.accountItemsNeedSync || Boolean(connection.status);

  return (
    <section className="dashboard-panel connection-panel" id="freee" aria-labelledby="connection-heading">
      <header className="connection-heading">
        <h2 id="connection-heading">freee会計</h2>
        <p className={`connection-state${connected ? "" : " inactive"}`}>{connectionLabel}</p>
      </header>
      <dl className="connection-meta">
        <div><dt>事業所</dt><dd>{connection.companyName ?? "未選択"}</dd></div>
        <div><dt>最終同期</dt><dd>{syncTime}</dd></div>
        {lastClosedSalesMonth === lastClosedExpenseMonth ? (
          <div><dt>締め済み実績</dt><dd>{closedMonthLabel(lastClosedSalesMonth)}</dd></div>
        ) : (
          <>
            <div><dt>売上の締め月</dt><dd>{closedMonthLabel(lastClosedSalesMonth)}</dd></div>
            <div><dt>支出の締め月</dt><dd>{closedMonthLabel(lastClosedExpenseMonth)}</dd></div>
          </>
        )}
      </dl>
      {(connected || configured) && (
        <div className="connection-actions">
          {canSync && (
            <form action={actions.sync}>
              <button className="dashboard-button" type="submit">freeeから同期</button>
            </form>
          )}
          {configured && !canSync && (
            <form action={actions.startFreee}>
              <button className="dashboard-button" type="submit">{connected ? "freeeで再ログイン" : "freeeでログイン"}</button>
            </form>
          )}
          {connected && (
            <form action={actions.disconnectFreee}>
              <button className={`dashboard-button${canSync || needsLogin ? " secondary" : ""}`} type="submit">接続を解除</button>
            </form>
          )}
        </div>
      )}
      {hasMessages && (
        <div className="connection-messages">
          {needsLogin && <p className="connection-message">同期するにはfreeeで再ログインし、実績を取り込んでください。</p>}
          {needsSetup && (
            <p className="connection-message">
              {syncedAt ? "取り込み済みの実績で見込みを計算できます。再同期には" : "実績を同期するには"}
              freeeログインのサーバー設定が必要です。
            </p>
          )}
          {connection.accountItemsNeedSync && <p className="connection-message">勘定科目別の内訳を表示するには、freeeから実績を再同期してください。</p>}
          {connection.status && <p className="connection-message">{connection.status}</p>}
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

function ClosedMonthField({ name, label, value, fallbackLabel, maxClosedMonth }: {
  name: string;
  label: string;
  value: number | null;
  fallbackLabel: string;
  maxClosedMonth: number;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <select name={name} defaultValue={value ?? ""}>
        <option value="">{fallbackLabel}</option>
        <option value={0}>締め済みの月なし</option>
        {months.slice(0, maxClosedMonth).map((month) => <option key={month} value={month}>{month}月</option>)}
      </select>
    </label>
  );
}

function TaxForm({ tax, lastClosedSalesMonthSetting, lastClosedExpenseMonthSetting, maxClosedMonth, action }:
  Pick<DashboardProps, "tax" | "lastClosedSalesMonthSetting" | "lastClosedExpenseMonthSetting" | "maxClosedMonth"> & {
  action: FormAction;
}) {
  return (
    <section className="dashboard-panel" aria-labelledby="tax-heading">
      <header className="panel-heading">
        <h2 id="tax-heading">年の前提と税金</h2>
        <p>該当しない金額には0円を入力してください。</p>
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
                {Object.entries(consumptionMethodLabels).map(([method, label]) => <option key={method} value={method}>{label}</option>)}
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
            <fieldset className="form-group">
              <legend>集計期間</legend>
              <div className="field-grid">
                <ClosedMonthField name="lastClosedSalesMonth" label="売上の締め済み最終月" value={lastClosedSalesMonthSetting}
                  fallbackLabel="共通の設定に従う" maxClosedMonth={maxClosedMonth} />
                <ClosedMonthField name="lastClosedExpenseMonth" label="支出の締め済み最終月" value={lastClosedExpenseMonthSetting}
                  fallbackLabel="共通の設定に従う" maxClosedMonth={maxClosedMonth} />
              </div>
              <p className="form-hint">売上と経費で締め月が異なる場合に設定します。</p>
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
            </fieldset>
          </div>
        </details>
        <div className="form-footer">
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
            ? "売上と経費それぞれについて、1月から締め月までの集計できた実績を平均します。"
            : "月ごとの着地額を入力します。空欄の項目は締め月までの月平均で見積もります。"}</p>
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
                  {remainingMonths.map(({ month, closedByAmount, forecast: amounts }) => (
                    <tr key={month}>
                      <th scope="row">{month}月</th>
                      <td className="numeric-cell">{closedByAmount.sales ? "締め済み" : yen(amounts.sales)}</td>
                      <td className="numeric-cell">{closedByAmount.expenses ? "締め済み" : yen(amounts.expenses)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="plan-list">
              {remainingMonths.map(({ month, closedByAmount }) => {
                const plan = plans.find((entry) => entry.month === month);
                const salesOpen = !closedByAmount.sales;
                const expensesOpen = !closedByAmount.expenses;
                const hasPlan = (salesOpen && (plan?.sales != null || plan?.salesTax != null))
                  || (expensesOpen && (plan?.expenses != null || plan?.deductiblePurchaseTax != null));
                return (
                  <details className="plan-edit" key={month}>
                    <summary>{month}月{hasPlan && <span className="plan-state">入力済み</span>}</summary>
                    <form action={actions.savePlan} className="editable-form" aria-label={`${month}月の見込みを編集`}>
                      <input type="hidden" name="month" value={month} />
                      {!salesOpen && <p className="form-hint">事業売上は締め済みです。</p>}
                      {!expensesOpen && <p className="form-hint">事業経費は締め済みです。</p>}
                      <div className="field-grid">
                        {salesOpen && <AmountField name="sales" label="事業売上" value={plan?.sales} signed />}
                        {expensesOpen && <AmountField name="expenses" label="事業経費" value={plan?.expenses} signed />}
                        {salesOpen && <AmountField name="salesTax" label="売上に係る消費税" value={plan?.salesTax} signed />}
                        {expensesOpen && <AmountField name="deductiblePurchaseTax" label="控除対象の仕入税額" value={plan?.deductiblePurchaseTax} signed />}
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

export function ForecastDashboard({
  year, forecast, accountItems, tax, plans, monthlyPlanMode, lastClosedSalesMonth, lastClosedExpenseMonth, defaultClosedMonth, maxClosedMonth,
  lastClosedMonthSetting, lastClosedSalesMonthSetting, lastClosedExpenseMonthSetting, connection, notice, actions,
}: DashboardProps) {
  const itemColors = getAccountItemColors(accountItems);
  const forecastBreakdown = summarizeAccountItems(forecast.months, accountItems);
  const needsSync = connection.accountItemsNeedSync;
  const individualCutoffs = lastClosedSalesMonthSetting !== null || lastClosedExpenseMonthSetting !== null;
  const defaultCutoffLabel = defaultClosedMonth === 12 ? "自動（12月まで）"
    : defaultClosedMonth === 0 ? "自動（締め済み月なし）" : `自動・前月（${defaultClosedMonth}月）`;
  return (
    <div className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="topbar-content">
          <a href="#overview" className="dashboard-brand"><span className="brand-mark" aria-hidden="true">年</span>{APP_NAME}</a>
          <nav className="dashboard-nav" aria-label="ダッシュボード">
            <a href="#summary">年末の見込み</a>
            <a href="#monthly">月ごとの収支</a>
            <a href="#settings">予測の前提</a>
            <a href="#freee">freee連携</a>
          </nav>
          <form className="topbar-session" action={actions.logout}><button type="submit" className="dashboard-button secondary">ログアウト</button></form>
        </div>
      </header>
      <main id="overview" className="dashboard-main">
        <header className="dashboard-header">
          <p className="dashboard-period">{year}年1月〜12月</p>
          <h1 className="dashboard-title">年間の収支と税金</h1>
        </header>
        {notice && <p className="dashboard-notice" role="status">{notice}</p>}
        <ActualSummary forecast={forecast} accountItems={accountItems} itemColors={itemColors} needsSync={needsSync} />
        <section id="summary" aria-labelledby="summary-heading">
          <div className="section-heading forecast-heading">
            <div className="section-title">
              <h2 id="summary-heading">年末の見込み</h2>
              <p>締め月までの月平均で、翌月以降の売上と経費を見積もります。</p>
              <p>住民税は{year}年の所得をもとに、{year + 1}年1月1日時点で大分県別府市に住所がある場合を試算します。所得税と消費税には全国共通の税率を使います。</p>
            </div>
            <form action={actions.saveClosedMonth} className="forecast-cutoff">
              <div className="forecast-cutoff-controls">
                <ClosedMonthField name="lastClosedMonth" label="締め済み最終月" value={lastClosedMonthSetting}
                  fallbackLabel={defaultCutoffLabel} maxClosedMonth={defaultClosedMonth} />
                <button className="dashboard-button" type="submit">反映</button>
              </div>
              {individualCutoffs && (
                <p>個別設定を適用中（売上は{closedMonthLabel(lastClosedSalesMonth)}、経費は{closedMonthLabel(lastClosedExpenseMonth)}）。反映すると、選択した月が共通の締め月になります。</p>
              )}
            </form>
          </div>
          <div className="financial-grid">
            <MetricCard title="事業売上" amount={forecast.sales}
              footer={<ForecastAmountCalculation forecast={forecast} amountKey="sales" />}>
              <AccountBreakdownList breakdown={forecastBreakdown.sales} itemColors={itemColors} needsSync={needsSync} />
            </MetricCard>
            <MetricCard title="支出（事業経費）" amount={forecast.expenses}
              footer={<ForecastAmountCalculation forecast={forecast} amountKey="expenses" />}>
              <AccountBreakdownList breakdown={forecastBreakdown.expenses} itemColors={itemColors} needsSync={needsSync} />
            </MetricCard>
            <IncomeForecastCard forecast={forecast} />
          </div>
          <div className="metrics-grid">
            <DonationLimitCard forecast={forecast} year={year} />
            <IncomeTaxCard forecast={forecast} />
            <ConsumptionTaxCard forecast={forecast} />
          </div>
        </section>
        <div className="dashboard-overview">
          <MonthlyChart rows={forecast.months} accountItems={accountItems} itemColors={itemColors} />
          <ConnectionPanel connection={connection} lastClosedSalesMonth={lastClosedSalesMonth} lastClosedExpenseMonth={lastClosedExpenseMonth}
            actions={actions} />
        </div>
        <section id="settings" className="dashboard-settings" aria-labelledby="settings-heading">
          <div className="section-heading"><h2 id="settings-heading">予測の前提</h2></div>
          <div className="settings-grid">
            <TaxForm tax={tax} lastClosedSalesMonthSetting={lastClosedSalesMonthSetting}
              lastClosedExpenseMonthSetting={lastClosedExpenseMonthSetting} maxClosedMonth={maxClosedMonth} action={actions.saveTax} />
            <MonthlyPlans plans={plans} monthlyPlanMode={monthlyPlanMode} forecast={forecast} actions={actions} />
          </div>
        </section>
      </main>
    </div>
  );
}
