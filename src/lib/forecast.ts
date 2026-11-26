export const FORECAST_YEAR = 2026;

const amountKeys = ["sales", "expenses", "salesTax", "deductiblePurchaseTax"] as const;
type AmountKey = (typeof amountKeys)[number];
type AmountSource = "actual" | "plan" | "average" | "missing";

export type AmountValues = Record<AmountKey, number | null>;
export type MonthAmounts = { month: number } & Partial<AmountValues>;

export interface ForecastMonth {
  month: number;
  closed: boolean;
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
  actuals: MonthAmounts[];
  plans?: MonthAmounts[];
  tax?: TaxInputs;
}

type ForecastMetric = "sales" | "expenses" | "incomeTax" | "incomeTaxSettlement"
  | "donationLimit" | "donationRemaining" | "consumptionTax";

export interface ForecastResult extends Record<ForecastMetric, number | null> {
  businessProfit: number | null;
  salaryGross: number | null;
  donationsPaid: number | null;
  donationsPlanned: number | null;
  months: ForecastMonth[];
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

function averageClosedAmount(actuals: Map<number, MonthAmounts>, lastClosedMonth: number, key: AmountKey) {
  const amounts: number[] = [];
  for (let month = lastClosedMonth; month > 0 && amounts.length < 3; month--) {
    const amount = readAmount(actuals.get(month)?.[key]);
    if (amount !== null) amounts.push(amount);
  }
  return amounts.length ? Math.round(amounts.reduce((total, amount) => total + amount, 0) / amounts.length) : null;
}

function forecastMonths(input: ForecastInput): ForecastMonth[] {
  const actuals = new Map(input.actuals.map((record) => [record.month, record]));
  const plans = new Map(input.plans?.map((record) => [record.month, record]));
  const lastClosedMonth = Number.isInteger(input.lastClosedMonth) ? Math.min(12, Math.max(0, input.lastClosedMonth)) : 0;
  const averages = mapAmounts((key) => averageClosedAmount(actuals, lastClosedMonth, key));

  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const closed = month <= lastClosedMonth;
    const actual = mapAmounts((key) => readAmount(actuals.get(month)?.[key]));
    const plan = mapAmounts((key) => readAmount(plans.get(month)?.[key]));
    const forecast = mapAmounts((key) => closed ? actual[key] : plan[key] ?? averages[key]);
    const sources = mapAmounts<AmountSource>((key) => {
      if (forecast[key] === null) return "missing";
      if (closed) return "actual";
      return plan[key] === null ? "average" : "plan";
    });
    return { month, closed, actual, forecast, sources };
  });
}

function annualAmount(months: ForecastMonth[], key: AmountKey): { amount: number | null; missing: string[] } {
  const missingMonths = months.filter((month) => month.forecast[key] === null).map((month) => month.month);
  if (missingMonths.length) {
    return { amount: null, missing: [`${amountLabels[key]}（${missingMonths.join("・")}月）`] };
  }
  return { amount: months.reduce((total, month) => total + (month.forecast[key] ?? 0), 0), missing: [] };
}

// 令和8年分 所得税の税額表等（国税庁）
// https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/shinkoku/pdf/r08/zeigakuhyo.pdf
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

function taxAmountWithReconstruction(taxableIncome: number, taxCredit: number): number {
  const roundedIncome = floorTo(Math.max(0, taxableIncome), 1_000);
  const bracket = incomeBrackets.find(({ lower }) => roundedIncome >= lower) ?? incomeBrackets[6];
  const incomeTax = Math.max(0, Math.floor(roundedIncome * bracket.percent / 100) - bracket.deduction - taxCredit);
  return incomeTax + Math.floor(incomeTax * 21 / 1_000);
}

function missingTaxAmounts(tax: TaxInputs, keys: (keyof typeof taxLabels)[]): string[] {
  return keys.filter((key) => readTaxAmount(tax[key]) === null).map((key) => taxLabels[key]);
}

function computeIncomeTax(totalIncome: number, tax: TaxInputs) {
  const missing = missingTaxAmounts(tax, ["otherIncomeDeductions", "incomeTaxCredit", "donationsPaid", "donationsPlanned"]);
  const donations = (tax.donationsPaid ?? 0) + (tax.donationsPlanned ?? 0);
  if (donations > 2_000 && !tax.donationMethod) missing.push("ふるさと納税の申告方法");
  if (missing.length) return { amount: null, missing };

  const donationDeduction = tax.donationMethod === "return"
    ? Math.max(0, Math.min(donations, Math.floor(totalIncome * 40 / 100)) - 2_000)
    : 0;
  const taxableIncome = totalIncome - incomeBasicDeduction2026(totalIncome) - (tax.socialInsurance ?? 0)
    - (tax.otherIncomeDeductions ?? 0) - donationDeduction;
  return { amount: taxAmountWithReconstruction(taxableIncome, tax.incomeTaxCredit ?? 0), missing };
}

// 個人住民税の所得割を標準税率10%で見積もる。調整控除の確定額は入力で置き換え可能。
function residentIncomeLevy(totalIncome: number, taxableIncome: number, otherPersonalDifference: number, tax: TaxInputs) {
  if (totalIncome <= 450_000 || taxableIncome === 0) return 0;
  const adjustmentDifference = 50_000 + otherPersonalDifference;
  const adjustmentBase = taxableIncome <= 2_000_000
    ? Math.min(adjustmentDifference, taxableIncome)
    : Math.max(50_000, adjustmentDifference - (taxableIncome - 2_000_000));
  const adjustment = readTaxAmount(tax.residentAdjustmentDeduction)
    ?? (totalIncome > 25_000_000 ? 0 : Math.floor(adjustmentBase * 5 / 100));
  return Math.max(0, taxableIncome / 10 - adjustment);
}

function computeDonationLimit(totalIncome: number, tax: TaxInputs) {
  const missing = missingTaxAmounts(tax, ["otherResidentDeductions"]);
  if ((tax.otherResidentDeductions ?? 0) > 0 && readTaxAmount(tax.residentPersonalDeductionDifference) === null) {
    missing.push(taxLabels.residentPersonalDeductionDifference);
  }
  if ((tax.incomeTaxCredit ?? 0) > 0 && tax.donationMethod !== "one-stop") {
    missing.push("税額控除のある場合の寄附上限は試算対象外");
  }
  if (missing.length) return { amount: null, missing };

  const otherPersonalDifference = tax.residentPersonalDeductionDifference ?? 0;
  const taxableIncome = floorTo(Math.max(0, totalIncome - residentBasicDeduction(totalIncome)
    - (tax.socialInsurance ?? 0) - (tax.otherResidentDeductions ?? 0)), 1_000);
  const levy = residentIncomeLevy(totalIncome, taxableIncome, otherPersonalDifference, tax);
  if (levy === 0) return { amount: 0, missing };

  // 特例控除の税率区分は所得税本体の課税所得とは異なる。
  // https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/kojin-shiminzei-kenminzei/kihukin.html
  const statutoryBasicDifference = totalIncome <= 24_000_000 ? 50_000
    : Math.max(0, incomeBasicDeduction2026(totalIncome) - residentBasicDeduction(totalIncome));
  const bracketIncome = taxableIncome - otherPersonalDifference - statutoryBasicDifference
    - Math.max(0, incomeBasicDeduction2026(totalIncome) - 480_000);
  const bracket = incomeBrackets.find(({ lower }) => bracketIncome > lower);
  const marginalPercent = bracketIncome < 0 ? 0 : (bracket?.percent ?? 5);
  const specialRate = (90_000 - marginalPercent * 1_021) / 100_000;
  const estimatedLimit = 2_000 + Math.floor(levy * 0.2 / specialRate);
  const amount = Math.min(estimatedLimit, Math.floor(totalIncome * 30 / 100));
  return { amount, missing };
}

function computeConsumptionTax(months: ForecastMonth[], tax: TaxInputs) {
  const method = tax.consumptionMethod;
  if (!method) return { amount: null, missing: ["消費税の申告方式"] };
  if (method === "exempt") return { amount: 0, missing: [] };
  if (method === "two-tenths" && tax.twoTenthsEligible !== true) {
    return { amount: null, missing: ["2割特例の適用要件の確認"] };
  }

  const salesTax = annualAmount(months, "salesTax");
  if (salesTax.amount === null) return salesTax;
  const nationalSalesTax = Math.floor(Math.max(0, salesTax.amount) * 78 / 100);

  let nationalPurchaseCredit: number;
  if (method === "general") {
    const credits = annualAmount(months, "deductiblePurchaseTax");
    if (credits.amount === null) return credits;
    nationalPurchaseCredit = Math.floor(credits.amount * 78 / 100);
  } else {
    const deemedRate = method === "two-tenths" ? 80 : (tax.simplifiedPurchaseRate ?? 0) * 100;
    if (![40, 50, 60, 70, 80, 90].includes(deemedRate)) {
      return { amount: null, missing: ["簡易課税のみなし仕入率"] };
    }
    nationalPurchaseCredit = Math.floor(nationalSalesTax * deemedRate / 100);
  }

  // 上流の税額は国税・地方税の合算額。帳票の法定課税標準は用いない試算。
  const net = nationalSalesTax - nationalPurchaseCredit;
  const nationalTax = net < 0 ? net : floorTo(net, 100);
  const localTax = net < 0 ? Math.ceil(net * 22 / 78) : floorTo(nationalTax * 22 / 78, 100);
  return { amount: nationalTax + localTax, missing: [] };
}

export function calculateForecast(input: ForecastInput): ForecastResult {
  const tax = input.tax ?? {};
  const months = forecastMonths(input);
  const sales = annualAmount(months, "sales");
  const expenses = annualAmount(months, "expenses");
  const businessProfit = sales.amount === null || expenses.amount === null ? null : sales.amount - expenses.amount;
  const salaryGross = readTaxAmount(tax.salaryGross);
  const donationsPaid = readTaxAmount(tax.donationsPaid);
  const donationsPlanned = readTaxAmount(tax.donationsPlanned);
  const incomeMissing = [...sales.missing, ...expenses.missing,
    ...missingTaxAmounts(tax, ["salaryGross", "blueDeduction", "socialInsurance"])];
  const yearIsSupported = input.year === FORECAST_YEAR;
  const unsupportedYear = ["税額試算の対応年分（2026年）"];
  if ((tax.blueDeduction ?? 0) > 650_000) incomeMissing.push("青色申告特別控除の適用額（65万円以下）");
  const appliedBlueDeduction = Math.min(Math.max(0, businessProfit ?? 0), tax.blueDeduction ?? 0);
  const totalIncome = incomeMissing.length ? null
    : Math.max(0, salaryIncome2026(salaryGross ?? 0) + (businessProfit ?? 0) - appliedBlueDeduction);
  if (totalIncome !== null && totalIncome > 330_000_000) incomeMissing.push("高所得に対する所得税の特例は試算対象外");

  const taxBasisMissing = yearIsSupported ? incomeMissing : unsupportedYear;
  const income = totalIncome === null || taxBasisMissing.length
    ? { amount: null, missing: taxBasisMissing } : computeIncomeTax(totalIncome, tax);
  const donation = totalIncome === null || taxBasisMissing.length
    ? { amount: null, missing: taxBasisMissing } : computeDonationLimit(totalIncome, tax);
  const consumption = yearIsSupported
    ? computeConsumptionTax(months, tax) : { amount: null, missing: unsupportedYear };

  const settlementMissing = [...income.missing, ...missingTaxAmounts(tax, ["withheldIncomeTax", "prepaidIncomeTax"])];
  const donationRemainingMissing = [...donation.missing, ...missingTaxAmounts(tax, ["donationsPaid"])];
  const afterWithholding = income.amount === null ? null : income.amount - (tax.withheldIncomeTax ?? 0);
  const incomeTaxSettlement = afterWithholding === null || settlementMissing.length ? null
    : (afterWithholding >= 0 ? floorTo(afterWithholding, 100) : afterWithholding) - (tax.prepaidIncomeTax ?? 0);

  return {
    months,
    sales: sales.amount,
    expenses: expenses.amount,
    businessProfit,
    salaryGross,
    incomeTax: income.amount,
    incomeTaxSettlement,
    donationsPaid,
    donationsPlanned,
    donationLimit: donation.amount,
    donationRemaining: donation.amount === null || donationRemainingMissing.length ? null
      : Math.max(0, donation.amount - (donationsPaid ?? 0)),
    consumptionTax: consumption.amount,
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
