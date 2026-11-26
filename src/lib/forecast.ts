export const FORECAST_YEAR = 2026;

// https://www.city.beppu.oita.jp/seikatu/zeikin/sikenminzei/sikumi_keisan.html
// https://www.city.beppu.oita.jp/seikatu/zeikin/sikenminzei/sinkoku.html
export const BEPPU_RESIDENT_TAX = {
  cityRate: 6,
  prefectureRate: 4,
  singleIncomeExemptionLimit: 450_000,
  adjustmentRate: 5,
  adjustmentTaxableThreshold: 2_000_000,
  adjustmentMinimumBase: 50_000,
  specialCreditCapRate: 20,
  donationIncomeCapRate: 30,
  selfContribution: 2_000,
} as const;

const amountKeys = ["sales", "expenses", "salesTax", "deductiblePurchaseTax"] as const;
type AmountKey = (typeof amountKeys)[number];
type AmountSource = "actual" | "plan" | "average" | "missing";

export type AmountValues = Record<AmountKey, number | null>;
export type TaxableSalesByRate = Partial<Record<number, number>>;
export type MonthAmounts = { month: number; taxableSalesByRate?: TaxableSalesByRate | null } & Partial<AmountValues>;
export type MonthlyPlanMode = "trend" | "manual";

type TrendMonth = { month: number; amount: number };

export type TrendEstimate =
  | { method: "unavailable"; amount: null; included: [] }
  | { method: "mean"; amount: number; included: TrendMonth[] };

export interface ForecastMonth {
  month: number;
  closed: boolean;
  closedByAmount: Record<AmountKey, boolean>;
  actual: AmountValues;
  forecast: AmountValues;
  sources: Record<AmountKey, AmountSource>;
}

export interface TaxInputs {
  salaryGross?: number | null;
  blueDeduction?: number | null;
  socialInsurance?: number | null;
  otherIncomeDeductions?: number | null;
  otherResidentDeductions?: number | null;
  residentAdjustmentDeduction?: number | null;
  residentPersonalDeductionDifference?: number | null;
  incomeTaxCredit?: number | null;
  withheldIncomeTax?: number | null;
  prepaidIncomeTax?: number | null;
  donationsPaid?: number | null;
  donationsPlanned?: number | null;
  donationMethod?: "return" | "one-stop";
  consumptionMethod?: "exempt" | "general" | "simplified" | "two-tenths";
  simplifiedPurchaseRate?: number | null;
  twoTenthsEligible?: boolean;
}

export const DEFAULT_TAX_FORM_AMOUNTS = {
  blueDeduction: 650_000,
  otherIncomeDeductions: 0,
  otherResidentDeductions: 0,
  incomeTaxCredit: 0,
  donationsPlanned: 0,
} as const satisfies Partial<TaxInputs>;

export interface ForecastInput {
  year: number;
  lastClosedMonth: number;
  lastClosedSalesMonth?: number;
  lastClosedExpenseMonth?: number;
  actuals: MonthAmounts[];
  plans?: MonthAmounts[];
  tax?: TaxInputs;
}

type ForecastMetric = "sales" | "expenses" | "incomeTax" | "incomeTaxSettlement"
  | "donationLimit" | "donationRemaining" | "consumptionTax";

export interface IncomeTaxDetails {
  totalIncome: number;
  basicDeduction: number;
  socialInsurance: number;
  otherIncomeDeductions: number;
  donationDeduction: number;
  taxableIncome: number;
  rate: number;
  bracketDeduction: number;
  taxCredit: number;
  baseTax: number;
  reconstructionRate: number;
  reconstructionTax: number;
}

interface DonationLimitDetails {
  totalIncome: number;
  basicDeduction: number;
  socialInsurance: number;
  otherDeductions: number;
  taxableIncome: number;
  cityTax: number;
  prefectureTax: number;
  incomeExempt: boolean;
  personalDeductionDifference: number;
  adjustmentBase: number | null;
  adjustmentDeduction: number;
  incomeLevy: number;
  specialCreditCap: number;
  nationalIncomeRateForDonation: number;
  specialCreditRate: number;
  estimatedLimit: number;
  donationIncomeCap: number;
}

type ConsumptionTaxCredit = { method: "general"; purchaseTax: number }
  | { method: "simplified" | "two-tenths"; deemedPurchaseRate: number };

export type ConsumptionTaxDetails = { method: "exempt" } | (ConsumptionTaxCredit & {
  salesTax: number;
  nationalSalesShare: number;
  nationalSalesTax: number;
  nationalPurchaseCredit: number;
  nationalTax: number;
  localTax: number;
  localTaxNumerator: number;
  localTaxDenominator: number;
});

type TaxEstimate<Details> = {
  amount: number | null;
  details: Details | null;
  missing: string[];
};

export interface ForecastResult extends Record<ForecastMetric, number | null> {
  businessProfit: number | null;
  salaryGross: number | null;
  incomeForecast: {
    businessIncome: number | null;
    appliedBlueDeduction: number | null;
    salaryIncome: number | null;
    salaryDeduction: number | null;
    totalIncome: number | null;
    missing: string[];
  };
  donationsPaid: number | null;
  donationsPlanned: number | null;
  incomeTaxDetails: IncomeTaxDetails | null;
  donationLimitDetails: DonationLimitDetails | null;
  taxableSalesByRate: TaxableSalesByRate | null;
  consumptionTaxDetails: ConsumptionTaxDetails | null;
  months: ForecastMonth[];
  trend: Record<AmountKey, TrendEstimate>;
  missing: Record<ForecastMetric, string[]>;
}

const amountLabels: Record<AmountKey, string> = {
  sales: "事業売上",
  expenses: "事業経費",
  salesTax: "売上に係る消費税",
  deductiblePurchaseTax: "控除対象の仕入税額",
};

const taxLabels = {
  salaryGross: "給与・賞与の額面",
  blueDeduction: "青色申告特別控除",
  socialInsurance: "社会保険料控除",
  otherIncomeDeductions: "所得税のその他の所得控除",
  otherResidentDeductions: "住民税のその他の所得控除",
  residentPersonalDeductionDifference: "人的控除差額（基礎控除分を除く）",
  incomeTaxCredit: "所得税の税額控除",
  withheldIncomeTax: "源泉徴収額",
  prepaidIncomeTax: "予定納税額",
  donationsPaid: "ふるさと納税の寄附済額",
  donationsPlanned: "ふるさと納税の寄附予定額",
};

const incomeBrackets = [
  { lower: 40_000_000, percent: 45, deduction: 4_796_000 },
  { lower: 18_000_000, percent: 40, deduction: 2_796_000 },
  { lower: 9_000_000, percent: 33, deduction: 1_536_000 },
  { lower: 6_950_000, percent: 23, deduction: 636_000 },
  { lower: 3_300_000, percent: 20, deduction: 427_500 },
  { lower: 1_950_000, percent: 10, deduction: 97_500 },
  { lower: 0, percent: 5, deduction: 0 },
] as const;

const reconstructionPerThousand = 21;

const floorTo = (value: number, unit: number) => Math.floor(value / unit) * unit;

function readAmount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function readTaxAmount(value: number | null | undefined): number | null {
  const amount = readAmount(value);
  return amount !== null && amount >= 0 ? amount : null;
}

function mapAmounts<T>(callback: (key: AmountKey) => T): Record<AmountKey, T> {
  return {
    sales: callback("sales"),
    expenses: callback("expenses"),
    salesTax: callback("salesTax"),
    deductiblePurchaseTax: callback("deductiblePurchaseTax"),
  };
}

export function calculateTrend(actuals: ReadonlyMap<number, MonthAmounts>, lastClosedMonth: number, key: AmountKey): TrendEstimate {
  const included: TrendMonth[] = [];
  for (let month = 1; month <= lastClosedMonth; month++) {
    const amount = readAmount(actuals.get(month)?.[key]);
    if (amount !== null) included.push({ month, amount });
  }
  if (included.length === 0) return { method: "unavailable", amount: null, included: [] };

  const amount = Math.round(included.reduce((total, entry) => total + entry.amount, 0) / included.length);
  return { method: "mean", amount: amount === 0 ? 0 : amount, included };
}

function forecastMonths(
  input: ForecastInput,
  actuals: Map<number, MonthAmounts>,
  closedThrough: Record<AmountKey, number>,
  trend: Record<AmountKey, TrendEstimate>,
): ForecastMonth[] {
  const plans = new Map(input.plans?.map((record) => [record.month, record]));

  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const closedByAmount = mapAmounts((key) => month <= closedThrough[key]);
    const actual = mapAmounts((key) => readAmount(actuals.get(month)?.[key]));
    const plan = mapAmounts((key) => readAmount(plans.get(month)?.[key]));
    const forecast = mapAmounts((key) => closedByAmount[key] ? actual[key] : plan[key] ?? trend[key].amount);
    const sources = mapAmounts<AmountSource>((key) => {
      if (forecast[key] === null) return "missing";
      if (closedByAmount[key]) return "actual";
      return plan[key] === null ? "average" : "plan";
    });
    return { month, closed: closedByAmount.sales && closedByAmount.expenses, closedByAmount, actual, forecast, sources };
  });
}

function addTaxableSales(total: TaxableSalesByRate, sales: TaxableSalesByRate) {
  for (const [rate, amount] of Object.entries(sales)) {
    const percent = Number(rate);
    if (amount !== undefined) total[percent] = (total[percent] ?? 0) + amount;
  }
}

function annualTaxableSales(
  months: ForecastMonth[],
  actuals: Map<number, MonthAmounts>,
  lastClosedSalesMonth: number,
  trendMonths: TrendMonth[],
): TaxableSalesByRate | null {
  const total: TaxableSalesByRate = {};

  for (const { month, closedByAmount, sources } of months) {
    if (!closedByAmount.sales) {
      if (sources.salesTax !== "average" || sources.sales === "plan") return null;
      continue;
    }
    const sales = actuals.get(month)?.taxableSalesByRate;
    if (sales == null) return null;
    addTaxableSales(total, sales);
  }

  const forecastMonthCount = months.length - lastClosedSalesMonth;
  if (forecastMonthCount === 0) return total;

  const trendTotal: TaxableSalesByRate = {};
  for (const { month } of trendMonths) {
    const sales = actuals.get(month)?.taxableSalesByRate;
    if (sales == null) return null;
    addTaxableSales(trendTotal, sales);
  }
  for (const [rate, amount] of Object.entries(trendTotal)) {
    const percent = Number(rate);
    const monthlyAverage = Math.round((amount ?? 0) / trendMonths.length);
    total[percent] = (total[percent] ?? 0) + monthlyAverage * forecastMonthCount;
  }
  return total;
}

function annualAmount(months: ForecastMonth[], key: AmountKey): { amount: number | null; missing: string[] } {
  const missingMonths = months.filter((month) => month.forecast[key] === null).map((month) => month.month);
  if (missingMonths.length) {
    return { amount: null, missing: [`${amountLabels[key]}（${missingMonths.join("・")}月）`] };
  }
  return { amount: months.reduce((total, month) => total + (month.forecast[key] ?? 0), 0), missing: [] };
}

// 国税庁の2026年分の給与所得の表（令和8年度税制改正後）。
// https://www.nta.go.jp/english/taxes/individual/12012.htm
export function salaryIncome2026(gross: number): number {
  if (gross < 741_000) return 0;
  if (gross < 2_191_000) return gross - 740_000;
  if (gross < 2_193_000) return 1_451_000;
  if (gross < 2_196_000) return 1_453_000;
  if (gross < 2_200_000) return 1_456_000;
  const quarterRounded = floorTo(gross / 4, 1_000);
  if (gross < 3_600_000) return quarterRounded * 28 / 10 - 80_000;
  if (gross < 6_600_000) return quarterRounded * 32 / 10 - 440_000;
  if (gross < 8_500_000) return Math.floor(gross * 9 / 10) - 1_100_000;
  return gross - 1_950_000;
}

export function incomeBasicDeduction2026(totalIncome: number): number {
  if (totalIncome <= 4_890_000) return 1_040_000;
  if (totalIncome <= 6_550_000) return 670_000;
  if (totalIncome <= 23_500_000) return 620_000;
  if (totalIncome <= 24_000_000) return 480_000;
  if (totalIncome <= 24_500_000) return 320_000;
  if (totalIncome <= 25_000_000) return 160_000;
  return 0;
}

function residentBasicDeduction(totalIncome: number): number {
  if (totalIncome <= 24_000_000) return 430_000;
  if (totalIncome <= 24_500_000) return 290_000;
  if (totalIncome <= 25_000_000) return 150_000;
  return 0;
}

function missingTaxAmounts(tax: TaxInputs, keys: (keyof typeof taxLabels)[]): string[] {
  return keys.filter((key) => readTaxAmount(tax[key]) === null).map((key) => taxLabels[key]);
}

function computeIncomeTax(totalIncome: number, tax: TaxInputs): TaxEstimate<IncomeTaxDetails> {
  const missing = missingTaxAmounts(tax, ["otherIncomeDeductions", "incomeTaxCredit", "donationsPaid", "donationsPlanned"]);
  const donations = (tax.donationsPaid ?? 0) + (tax.donationsPlanned ?? 0);
  if (donations > 2_000 && !tax.donationMethod) missing.push("ふるさと納税の申告方法");
  if (missing.length) return { amount: null, details: null, missing };

  const donationDeduction = tax.donationMethod === "return"
    ? Math.max(0, Math.min(donations, Math.floor(totalIncome * 40 / 100)) - 2_000)
    : 0;
  const basicDeduction = incomeBasicDeduction2026(totalIncome);
  const socialInsurance = tax.socialInsurance ?? 0;
  const otherIncomeDeductions = tax.otherIncomeDeductions ?? 0;
  const incomeAfterDeductions = totalIncome - basicDeduction - socialInsurance - otherIncomeDeductions - donationDeduction;
  const taxableIncome = floorTo(Math.max(0, incomeAfterDeductions), 1_000);
  const { percent: rate, deduction: bracketDeduction } = incomeBrackets.find(({ lower }) => taxableIncome >= lower)
    ?? incomeBrackets[6];
  const taxCredit = tax.incomeTaxCredit ?? 0;
  const baseTax = Math.max(0, Math.floor(taxableIncome * rate / 100) - bracketDeduction - taxCredit);
  const reconstructionTax = Math.floor(baseTax * reconstructionPerThousand / 1_000);
  return {
    amount: baseTax + reconstructionTax,
    details: {
      totalIncome, basicDeduction, socialInsurance, otherIncomeDeductions, donationDeduction, taxableIncome,
      rate, bracketDeduction, taxCredit, baseTax, reconstructionRate: reconstructionPerThousand / 10, reconstructionTax,
    },
    missing,
  };
}

function computeDonationLimit(totalIncome: number, tax: TaxInputs): TaxEstimate<DonationLimitDetails> {
  const missing = missingTaxAmounts(tax, ["otherResidentDeductions"]);
  if ((tax.otherResidentDeductions ?? 0) > 0 && readTaxAmount(tax.residentPersonalDeductionDifference) === null) {
    missing.push(taxLabels.residentPersonalDeductionDifference);
  }
  if ((tax.incomeTaxCredit ?? 0) > 0 && tax.donationMethod !== "one-stop") {
    missing.push("税額控除のある場合の寄附上限は試算対象外");
  }
  if (missing.length) return { amount: null, details: null, missing };

  const { cityRate, prefectureRate, singleIncomeExemptionLimit, adjustmentRate, adjustmentTaxableThreshold,
    adjustmentMinimumBase, specialCreditCapRate, donationIncomeCapRate, selfContribution } = BEPPU_RESIDENT_TAX;
  const basicDeduction = residentBasicDeduction(totalIncome);
  const socialInsurance = tax.socialInsurance ?? 0;
  const otherDeductions = tax.otherResidentDeductions ?? 0;
  const taxableIncome = floorTo(Math.max(0, totalIncome - basicDeduction - socialInsurance - otherDeductions), 1_000);
  const incomeExempt = totalIncome <= singleIncomeExemptionLimit;
  const cityTax = incomeExempt ? 0 : taxableIncome * cityRate / 100;
  const prefectureTax = incomeExempt ? 0 : taxableIncome * prefectureRate / 100;

  const otherPersonalDifference = tax.residentPersonalDeductionDifference ?? 0;
  const statutoryBasicDifference = totalIncome <= 24_000_000 ? 50_000
    : Math.max(0, incomeBasicDeduction2026(totalIncome) - basicDeduction);
  const personalDeductionDifference = otherPersonalDifference + statutoryBasicDifference;
  const canApplyAdjustment = !incomeExempt && taxableIncome > 0 && totalIncome <= 25_000_000;
  const fixedAdjustment = canApplyAdjustment ? readTaxAmount(tax.residentAdjustmentDeduction) : null;
  let adjustmentBase = null;
  if (canApplyAdjustment && fixedAdjustment === null) {
    adjustmentBase = taxableIncome <= adjustmentTaxableThreshold
      ? Math.min(personalDeductionDifference, taxableIncome)
      : Math.max(adjustmentMinimumBase, personalDeductionDifference - (taxableIncome - adjustmentTaxableThreshold));
  }
  const adjustmentDeduction = fixedAdjustment ?? Math.floor((adjustmentBase ?? 0) * adjustmentRate / 100);
  const incomeLevy = Math.max(0, cityTax + prefectureTax - adjustmentDeduction);

  // 特例控除の税率区分は所得税本体の課税所得とは異なる。
  // https://www.city.chofu.lg.jp/030010/p014041.html
  const bracketIncome = taxableIncome - personalDeductionDifference
    - Math.max(0, incomeBasicDeduction2026(totalIncome) - 480_000);
  const bracket = incomeBrackets.find(({ lower }) => bracketIncome > lower);
  const marginalPercent = bracketIncome < 0 ? 0 : (bracket?.percent ?? 5);
  const nationalRateScaled = marginalPercent * (1_000 + reconstructionPerThousand);
  const specialCreditRateScaled = (100 - cityRate - prefectureRate) * 1_000 - nationalRateScaled;
  const specialCreditCap = incomeLevy * specialCreditCapRate / 100;
  const estimatedLimit = incomeLevy === 0 ? 0
    : selfContribution + Math.floor(incomeLevy * specialCreditCapRate * 1_000 / specialCreditRateScaled);
  const donationIncomeCap = Math.floor(totalIncome * donationIncomeCapRate / 100);
  return {
    amount: Math.min(estimatedLimit, donationIncomeCap),
    details: {
      totalIncome, basicDeduction, socialInsurance, otherDeductions, taxableIncome, cityTax, prefectureTax, incomeExempt,
      personalDeductionDifference, adjustmentBase, adjustmentDeduction, incomeLevy, specialCreditCap,
      nationalIncomeRateForDonation: nationalRateScaled / 1_000, specialCreditRate: specialCreditRateScaled / 1_000,
      estimatedLimit, donationIncomeCap,
    },
    missing,
  };
}

function computeConsumptionTax(months: ForecastMonth[], tax: TaxInputs): TaxEstimate<ConsumptionTaxDetails> {
  const method = tax.consumptionMethod;
  if (!method) return { amount: null, details: null, missing: ["消費税の申告方式"] };
  if (method === "exempt") return { amount: 0, details: { method }, missing: [] };
  if (method === "two-tenths" && tax.twoTenthsEligible !== true) {
    return { amount: null, details: null, missing: ["2割特例の適用要件の確認"] };
  }

  const { amount: salesTax, missing } = annualAmount(months, "salesTax");
  if (salesTax === null) return { amount: null, details: null, missing };
  const nationalSalesShare = 78;
  const nationalSalesTax = Math.floor(Math.max(0, salesTax) * nationalSalesShare / 100);

  let credit: ConsumptionTaxCredit;
  let nationalPurchaseCredit: number;
  if (method === "general") {
    const { amount: purchaseTax, missing: purchaseMissing } = annualAmount(months, "deductiblePurchaseTax");
    if (purchaseTax === null) return { amount: null, details: null, missing: purchaseMissing };
    credit = { method, purchaseTax };
    nationalPurchaseCredit = Math.floor(purchaseTax * nationalSalesShare / 100);
  } else {
    const deemedPurchaseRate = method === "two-tenths" ? 80 : (tax.simplifiedPurchaseRate ?? 0) * 100;
    if (![40, 50, 60, 70, 80, 90].includes(deemedPurchaseRate)) {
      return { amount: null, details: null, missing: ["簡易課税のみなし仕入率"] };
    }
    credit = { method, deemedPurchaseRate };
    nationalPurchaseCredit = Math.floor(nationalSalesTax * deemedPurchaseRate / 100);
  }

  // 上流の税額は国税・地方税の合算額。帳票の法定課税標準は用いない試算。
  const net = nationalSalesTax - nationalPurchaseCredit;
  const nationalTax = net < 0 ? net : floorTo(net, 100);
  const localTaxNumerator = 100 - nationalSalesShare;
  const localTaxDenominator = nationalSalesShare;
  const localShare = nationalTax * localTaxNumerator / localTaxDenominator;
  const localTax = net < 0 ? Math.ceil(localShare) : floorTo(localShare, 100);
  return {
    amount: nationalTax + localTax,
    details: {
      ...credit, salesTax, nationalSalesShare, nationalSalesTax, nationalPurchaseCredit, nationalTax, localTax,
      localTaxNumerator, localTaxDenominator,
    },
    missing: [],
  };
}

export function calculateForecast(input: ForecastInput): ForecastResult {
  const tax = input.tax ?? {};
  const actuals = new Map(input.actuals.map((record) => [record.month, record]));
  const normalizeMonth = (month: number) => Number.isInteger(month) ? Math.min(12, Math.max(0, month)) : 0;
  const lastClosedSalesMonth = normalizeMonth(input.lastClosedSalesMonth ?? input.lastClosedMonth);
  const lastClosedExpenseMonth = normalizeMonth(input.lastClosedExpenseMonth ?? input.lastClosedMonth);
  const closedThrough = {
    sales: lastClosedSalesMonth,
    salesTax: lastClosedSalesMonth,
    expenses: lastClosedExpenseMonth,
    deductiblePurchaseTax: lastClosedExpenseMonth,
  };
  const trend = mapAmounts((key) => calculateTrend(actuals, closedThrough[key], key));
  const months = forecastMonths(input, actuals, closedThrough, trend);
  const sales = annualAmount(months, "sales");
  const expenses = annualAmount(months, "expenses");
  const businessProfit = sales.amount === null || expenses.amount === null ? null : sales.amount - expenses.amount;
  const salaryGross = readTaxAmount(tax.salaryGross);
  const blueDeduction = readTaxAmount(tax.blueDeduction);
  const unsupportedBlueDeduction = (tax.blueDeduction ?? 0) > 650_000;
  const donationsPaid = readTaxAmount(tax.donationsPaid);
  const donationsPlanned = readTaxAmount(tax.donationsPlanned);
  const yearIsSupported = input.year === FORECAST_YEAR;
  const unsupportedYear = ["税額試算の対応年分（2026年）"];
  const missingIncome = [...sales.missing, ...expenses.missing, ...missingTaxAmounts(tax, ["salaryGross", "blueDeduction"])];
  if (unsupportedBlueDeduction) missingIncome.push("青色申告特別控除の適用額（65万円以下）");
  const appliedBlueDeduction = !yearIsSupported || businessProfit === null || blueDeduction === null || unsupportedBlueDeduction
    ? null : Math.min(Math.max(0, businessProfit), blueDeduction);
  const businessIncome = businessProfit === null || appliedBlueDeduction === null ? null : businessProfit - appliedBlueDeduction;
  const salaryIncome = yearIsSupported && salaryGross !== null ? salaryIncome2026(salaryGross) : null;
  const salaryDeduction = salaryGross === null || salaryIncome === null ? null : salaryGross - salaryIncome;
  const totalIncome = businessIncome === null || salaryIncome === null ? null : Math.max(0, businessIncome + salaryIncome);

  const taxBasisMissing = yearIsSupported ? [...missingIncome, ...missingTaxAmounts(tax, ["socialInsurance"])] : unsupportedYear;
  if (totalIncome !== null && totalIncome > 330_000_000 && taxBasisMissing.length === 0) {
    taxBasisMissing.push("高所得に対する所得税の特例は試算対象外");
  }

  const income = totalIncome === null || taxBasisMissing.length
    ? { amount: null, details: null, missing: taxBasisMissing } : computeIncomeTax(totalIncome, tax);
  const donation = totalIncome === null || taxBasisMissing.length
    ? { amount: null, details: null, missing: taxBasisMissing } : computeDonationLimit(totalIncome, tax);
  const consumption = yearIsSupported
    ? computeConsumptionTax(months, tax) : { amount: null, details: null, missing: unsupportedYear };

  const settlementMissing = [...income.missing, ...missingTaxAmounts(tax, ["withheldIncomeTax", "prepaidIncomeTax"])];
  const donationRemainingMissing = [...donation.missing, ...missingTaxAmounts(tax, ["donationsPaid"])];
  const afterWithholding = income.amount === null ? null : income.amount - (tax.withheldIncomeTax ?? 0);
  const incomeTaxSettlement = afterWithholding === null || settlementMissing.length ? null
    : (afterWithholding >= 0 ? floorTo(afterWithholding, 100) : afterWithholding) - (tax.prepaidIncomeTax ?? 0);

  return {
    months,
    trend,
    sales: sales.amount,
    expenses: expenses.amount,
    businessProfit,
    salaryGross,
    incomeForecast: {
      businessIncome, appliedBlueDeduction, salaryIncome, salaryDeduction, totalIncome,
      missing: yearIsSupported ? missingIncome : ["所得試算の対応年分（2026年）"],
    },
    incomeTax: income.amount,
    incomeTaxDetails: income.details,
    incomeTaxSettlement,
    donationsPaid,
    donationsPlanned,
    donationLimit: donation.amount,
    donationLimitDetails: donation.details,
    donationRemaining: donation.amount === null || donationRemainingMissing.length ? null
      : Math.max(0, donation.amount - (donationsPaid ?? 0)),
    consumptionTax: consumption.amount,
    taxableSalesByRate: yearIsSupported ? annualTaxableSales(months, actuals, lastClosedSalesMonth, trend.salesTax.included) : null,
    consumptionTaxDetails: consumption.details,
    missing: {
      sales: sales.missing,
      expenses: expenses.missing,
      incomeTax: income.missing,
      incomeTaxSettlement: settlementMissing,
      donationLimit: donation.missing,
      donationRemaining: donationRemainingMissing,
      consumptionTax: consumption.missing,
    },
  };
}
