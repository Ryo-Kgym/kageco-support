import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateForecast,
  calculateTrend,
  FORECAST_YEAR,
  incomeBasicDeduction2026,
  salaryIncome2026,
} from "../src/lib/forecast";
import type { MonthAmounts, TaxInputs } from "../src/lib/forecast";

const allMonths = (first: Omit<MonthAmounts, "month">) => Array.from({ length: 12 }, (_, index) => ({
  month: index + 1,
  sales: 0,
  expenses: 0,
  salesTax: 0,
  deductiblePurchaseTax: 0,
  ...(index === 0 ? first : {}),
}));

const supportedTaxInputs: TaxInputs = {
  salaryGross: 0,
  blueDeduction: 0,
  socialInsurance: 0,
  otherIncomeDeductions: 0,
  otherResidentDeductions: 0,
  incomeTaxCredit: 0,
  donationsPaid: 0,
  donationsPlanned: 0,
  withheldIncomeTax: 0,
  prepaidIncomeTax: 0,
};

test("uses the average of all months through the cutoff, including both extremes", () => {
  const actuals = new Map([
    [1, { month: 1, sales: 9_999 }],
    [2, { month: 2, sales: 100 }],
    [3, { month: 3, sales: 10 }],
    [4, { month: 4, sales: 200 }],
    [5, { month: 5, sales: 0 }],
    [6, { month: 6, sales: 50 }],
    [7, { month: 7, sales: 999 }],
  ]);
  assert.deepEqual(calculateTrend(actuals, 6, "sales"), {
    method: "mean",
    amount: 1_727,
    included: [
      { month: 1, amount: 9_999 }, { month: 2, amount: 100 }, { month: 3, amount: 10 },
      { month: 4, amount: 200 }, { month: 5, amount: 0 }, { month: 6, amount: 50 },
    ],
  });
});

test("distinguishes missing values from recorded zeroes in the average", () => {
  const actuals = new Map([
    [1, { month: 1, expenses: 100 }],
    [2, { month: 2, expenses: 0 }],
    [3, { month: 3, expenses: 10 }],
    [4, { month: 4, expenses: null }],
    [5, { month: 5, expenses: -10 }],
    [6, { month: 6, expenses: null }],
  ]);
  assert.deepEqual(calculateTrend(actuals, 0, "expenses"), { method: "unavailable", amount: null, included: [] });
  assert.equal(calculateTrend(actuals, 1, "expenses").amount, 100);
  assert.deepEqual(calculateTrend(actuals, 2, "expenses"), {
    method: "mean", amount: 50, included: [{ month: 1, amount: 100 }, { month: 2, amount: 0 }],
  });
  assert.deepEqual(calculateTrend(actuals, 6, "expenses"), {
    method: "mean", amount: 25,
    included: [{ month: 1, amount: 100 }, { month: 2, amount: 0 }, { month: 3, amount: 10 }, { month: 5, amount: -10 }],
  });
  actuals.set(1, { month: 1, expenses: -1 });
  assert.equal(calculateTrend(actuals, 2, "expenses").amount, 0);
});

test("uses finalized months and whole-month overrides without adding the current month's partial actual", () => {
  const result = calculateForecast({
    year: FORECAST_YEAR,
    lastClosedMonth: 4,
    actuals: [
      { month: 1, sales: 500, expenses: 100 },
      { month: 2, sales: 200, expenses: 20 },
      { month: 3, sales: 300, expenses: 0 },
      { month: 4, sales: 400, expenses: 40 },
      { month: 5, sales: 110, expenses: 9 },
    ],
    plans: [{ month: 5, sales: 600, expenses: 0 }],
  });
  assert.equal(result.months[4].actual.sales, 110);
  assert.equal(result.months[4].forecast.sales, 600);
  assert.equal(result.months[4].forecast.expenses, 0);
  assert.equal(result.months[4].sources.sales, "plan");
  assert.equal(result.months[5].forecast.sales, 350);
  assert.equal(result.months[5].sources.sales, "average");
  assert.equal(result.sales, 4_450);
  assert.equal(result.expenses, 440);
});

test("uses separate closing months for sales, expenses, and their tax amounts", () => {
  const actuals = allMonths({}).map(({ month }) => month === 10
    ? { month, sales: 10, expenses: 400, salesTax: 1, deductiblePurchaseTax: 40, taxableSalesByRate: { 10: 10 } }
    : { month, sales: 1_000, expenses: 100, salesTax: 100, deductiblePurchaseTax: 10, taxableSalesByRate: { 10: 1_000 } });
  const input = {
    year: FORECAST_YEAR, lastClosedMonth: 10, lastClosedSalesMonth: 9, actuals,
    tax: { consumptionMethod: "general" } satisfies TaxInputs,
  };
  const result = calculateForecast(input);
  assert.equal(result.months[8].closed, true);
  assert.equal(result.months[9].closed, false);
  assert.deepEqual(result.months[9].closedByAmount, { sales: false, expenses: true, salesTax: false, deductiblePurchaseTax: true });
  assert.deepEqual(result.months[9].sources, { sales: "average", expenses: "actual", salesTax: "average", deductiblePurchaseTax: "actual" });
  assert.equal(result.months[9].actual.sales, 10);
  assert.equal(result.sales, 12_000);
  assert.equal(result.expenses, 1_560);
  assert.deepEqual(result.taxableSalesByRate, { 10: 12_000 });
  assert.equal(result.consumptionTaxDetails?.method, "general");
  assert.equal(result.consumptionTaxDetails.salesTax, 1_200);
  assert.equal(result.consumptionTaxDetails.purchaseTax, 156);

  const manual = calculateForecast({ ...input, plans: [{ month: 10, sales: 1_500, expenses: 99_999, salesTax: 150 }] });
  assert.equal(manual.sales, 12_500);
  assert.equal(manual.expenses, result.expenses);
  assert.equal(manual.taxableSalesByRate, null);
});

test("missing data is distinct from explicitly recorded zeroes", () => {
  const result = calculateForecast({
    year: FORECAST_YEAR,
    lastClosedMonth: 1,
    actuals: [{ month: 1, sales: 0 }],
    plans: [{ month: 2, expenses: 0 }],
    tax: { consumptionMethod: "exempt" },
  });
  assert.equal(result.sales, 0);
  assert.equal(result.expenses, null);
  assert.equal(result.consumptionTax, 0);
  assert.deepEqual(result.consumptionTaxDetails, { method: "exempt" });
  assert.equal(result.incomeTax, null);
  assert.equal(result.incomeTaxDetails, null);
  assert.equal(result.taxableSalesByRate, null);
  assert.equal(result.months[0].sources.expenses, "missing");
  assert.ok(result.missing.incomeTax.includes("給与・賞与の額面"));
});

test("uses the 2026 salary lookup and basic deduction boundaries", () => {
  assert.equal(salaryIncome2026(740_999), 0);
  assert.equal(salaryIncome2026(741_000), 1_000);
  assert.equal(salaryIncome2026(2_197_000), 1_456_000);
  assert.equal(salaryIncome2026(2_200_000), 1_460_000);
  // 国税庁 令和8年分 所得税の税額表等の計算例。
  assert.equal(salaryIncome2026(5_812_500), 4_209_600);
  assert.equal(incomeBasicDeduction2026(4_890_000), 1_040_000);
  assert.equal(incomeBasicDeduction2026(4_890_001), 670_000);
  assert.equal(incomeBasicDeduction2026(6_550_001), 620_000);
});

test("forecasts income independently of tax deductions and uses the same total when estimating tax", () => {
  const input = {
    year: FORECAST_YEAR,
    lastClosedMonth: 12,
    actuals: allMonths({ sales: 500_000, expenses: 300_000 }),
    tax: { salaryGross: 5_812_500, blueDeduction: 650_000 },
  };
  const result = calculateForecast(input);
  assert.deepEqual(result.incomeForecast, {
    businessIncome: 0,
    appliedBlueDeduction: 200_000,
    salaryIncome: 4_209_600,
    salaryDeduction: 1_602_900,
    totalIncome: 4_209_600,
    missing: [],
  });
  assert.equal(result.incomeTax, null);
  const withTaxInputs = calculateForecast({ ...input, tax: { ...supportedTaxInputs, ...input.tax } });
  assert.equal(withTaxInputs.incomeTaxDetails?.totalIncome, result.incomeForecast.totalIncome);
});

test("keeps business losses visible and distinguishes missing salary from zero income", () => {
  const input = { year: FORECAST_YEAR, lastClosedMonth: 12, actuals: allMonths({ expenses: 100_000 }) };
  const loss = calculateForecast({ ...input, tax: { salaryGross: 0, blueDeduction: 650_000 } });
  assert.equal(loss.incomeForecast.businessIncome, -100_000);
  assert.equal(loss.incomeForecast.appliedBlueDeduction, 0);
  assert.equal(loss.incomeForecast.salaryIncome, 0);
  assert.equal(loss.incomeForecast.totalIncome, 0);

  const withoutSalary = calculateForecast({ ...input, tax: { blueDeduction: 650_000 } });
  assert.equal(withoutSalary.incomeForecast.businessIncome, -100_000);
  assert.equal(withoutSalary.incomeForecast.salaryIncome, null);
  assert.equal(withoutSalary.incomeForecast.totalIncome, null);
  assert.deepEqual(withoutSalary.incomeForecast.missing, ["給与・賞与の額面"]);
});

test("computes estimated annual income tax and final amount after withholding and prepayments", () => {
  const result = calculateForecast({
    year: FORECAST_YEAR,
    lastClosedMonth: 12,
    actuals: allMonths({ sales: 7_120_999 }),
    tax: { ...supportedTaxInputs, withheldIncomeTax: 10_000, prepaidIncomeTax: 50_000 },
  });
  // 国税庁の課税所得650万円の例（所得税872,500円）に復興特別所得税を加算。
  assert.equal(result.incomeTax, 890_822);
  assert.equal(result.incomeTaxSettlement, 830_800);
  assert.deepEqual(result.incomeTaxDetails, {
    totalIncome: 7_120_999,
    basicDeduction: 620_000,
    socialInsurance: 0,
    otherIncomeDeductions: 0,
    donationDeduction: 0,
    taxableIncome: 6_500_000,
    rate: 20,
    bracketDeduction: 427_500,
    taxCredit: 0,
    baseTax: 872_500,
    reconstructionRate: 2.1,
    reconstructionTax: 18_322,
  });
});

test("donation limit uses resident income levy and tax return donations lower national tax", () => {
  const input = {
    year: FORECAST_YEAR,
    lastClosedMonth: 12,
    actuals: allMonths({}),
    tax: { ...supportedTaxInputs, salaryGross: 6_000_000, socialInsurance: 900_000, donationsPaid: 10_000 },
  };
  const oneStop = calculateForecast({ ...input, tax: { ...input.tax, donationMethod: "one-stop" } });
  const taxReturn = calculateForecast({ ...input, tax: { ...input.tax, donationMethod: "return" } });
  assert.equal(oneStop.donationLimit, 77_322);
  assert.equal(oneStop.donationRemaining, 67_322);
  assert.equal(taxReturn.donationLimit, oneStop.donationLimit);
  assert.ok((taxReturn.incomeTax ?? Infinity) < (oneStop.incomeTax ?? 0));
  assert.equal(oneStop.incomeTaxDetails?.donationDeduction, 0);
  assert.equal(taxReturn.incomeTaxDetails?.donationDeduction, 8_000);
  assert.deepEqual(oneStop.donationLimitDetails, {
    totalIncome: 4_360_000,
    basicDeduction: 430_000,
    socialInsurance: 900_000,
    otherDeductions: 0,
    taxableIncome: 3_030_000,
    cityTax: 181_800,
    prefectureTax: 121_200,
    incomeExempt: false,
    personalDeductionDifference: 50_000,
    adjustmentBase: 50_000,
    adjustmentDeduction: 2_500,
    incomeLevy: 300_500,
    specialCreditCap: 60_100,
    nationalIncomeRateForDonation: 10.21,
    specialCreditRate: 79.79,
    estimatedLimit: 77_322,
    donationIncomeCap: 1_308_000,
  });
});

test("uses Beppu's individual income levy exemption and applicable adjustment deductions", () => {
  const input = { year: FORECAST_YEAR, lastClosedMonth: 12, tax: supportedTaxInputs };
  const exempt = calculateForecast({ ...input, actuals: allMonths({ sales: 450_000 }) });
  assert.equal(exempt.donationLimitDetails?.incomeExempt, true);
  assert.equal(exempt.donationLimitDetails.taxableIncome, 20_000);
  assert.equal(exempt.donationLimitDetails.incomeLevy, 0);
  assert.equal(exempt.donationLimit, 0);

  const nearExemption = calculateForecast({ ...input, actuals: allMonths({ sales: 451_000 }) });
  assert.equal(nearExemption.donationLimitDetails?.incomeExempt, false);
  assert.equal(nearExemption.donationLimitDetails.adjustmentDeduction, 1_050);
  assert.equal(nearExemption.donationLimitDetails.incomeLevy, 1_050);

  const deduction = calculateForecast({
    ...input, actuals: allMonths({ sales: 24_200_000 }), tax: { ...input.tax, socialInsurance: 22_000_000 },
  });
  assert.equal(deduction.donationLimitDetails?.personalDeductionDifference, 30_000);
  assert.equal(deduction.donationLimitDetails.adjustmentDeduction, 1_500);

  const highIncome = calculateForecast({
    ...input, actuals: allMonths({ sales: 25_001_000 }), tax: { ...input.tax, residentAdjustmentDeduction: 2_500 },
  });
  assert.equal(highIncome.donationLimitDetails?.adjustmentDeduction, 0);
});

test("consumption tax uses qualified credits, deemed rates and confirmed eligibility", () => {
  const input = {
    year: FORECAST_YEAR,
    lastClosedMonth: 12,
    actuals: allMonths({ salesTax: 1_000_000, deductiblePurchaseTax: 600_000 }),
  };
  const general = calculateForecast({ ...input, tax: { consumptionMethod: "general" } });
  assert.equal(general.consumptionTax, 400_000);
  assert.deepEqual(general.consumptionTaxDetails, {
    method: "general",
    salesTax: 1_000_000,
    purchaseTax: 600_000,
    nationalSalesShare: 78,
    nationalSalesTax: 780_000,
    nationalPurchaseCredit: 468_000,
    nationalTax: 312_000,
    localTax: 88_000,
    localTaxNumerator: 22,
    localTaxDenominator: 78,
  });
  const simplified = calculateForecast({
    ...input, tax: { consumptionMethod: "simplified", simplifiedPurchaseRate: 0.7 },
  });
  assert.equal(simplified.consumptionTax, 300_000);
  assert.equal(simplified.consumptionTaxDetails?.method, "simplified");
  assert.equal(simplified.consumptionTaxDetails.deemedPurchaseRate, 70);
  assert.equal(simplified.consumptionTaxDetails.nationalPurchaseCredit, 546_000);
  const unconfirmed = calculateForecast({ ...input, tax: { consumptionMethod: "two-tenths" } });
  assert.equal(unconfirmed.consumptionTax, null);
  assert.equal(unconfirmed.consumptionTaxDetails, null);
  const twoTenths = calculateForecast({
    ...input, tax: { consumptionMethod: "two-tenths", twoTenthsEligible: true },
  });
  assert.equal(twoTenths.consumptionTax, 200_000);
  assert.equal(twoTenths.consumptionTaxDetails?.method, "two-tenths");
  assert.equal(twoTenths.consumptionTaxDetails.deemedPurchaseRate, 80);
  const refund = calculateForecast({
    ...input, actuals: allMonths({ salesTax: 50_000, deductiblePurchaseTax: 150_001 }),
    tax: { consumptionMethod: "general" },
  });
  assert.equal(refund.consumptionTax, -100_000);
  assert.equal(refund.consumptionTaxDetails?.method, "general");
  assert.equal(refund.consumptionTaxDetails.nationalTax, -78_000);
  assert.equal(refund.consumptionTaxDetails.localTax, -22_000);
});

test("estimates taxable sales by observed rate and only when the monthly basis is known", () => {
  const input = {
    year: FORECAST_YEAR,
    lastClosedMonth: 4,
    actuals: [
      { month: 1, salesTax: 38, taxableSalesByRate: { 8: 100, 10: 300 } },
      { month: 2, salesTax: 0, taxableSalesByRate: {} },
      { month: 3, salesTax: 16, taxableSalesByRate: { 8: 200 } },
      { month: 4, salesTax: 20, taxableSalesByRate: { 10: 200 } },
      { month: 5, salesTax: 900, taxableSalesByRate: { 10: 9_000 } },
    ],
    tax: { consumptionMethod: "two-tenths", twoTenthsEligible: true } satisfies TaxInputs,
  };
  const estimate = calculateForecast(input);
  assert.deepEqual(estimate.trend.salesTax.included, [
    { month: 1, amount: 38 }, { month: 2, amount: 0 }, { month: 3, amount: 16 }, { month: 4, amount: 20 },
  ]);
  assert.deepEqual(estimate.taxableSalesByRate, { 8: 900, 10: 1_500 });

  const manual = calculateForecast({ ...input, plans: [{ month: 5, salesTax: 30 }] });
  assert.equal(manual.taxableSalesByRate, null);
  assert.equal(manual.consumptionTaxDetails?.method, "two-tenths");

  const legacy = calculateForecast({ ...input, actuals: [{ month: 1, salesTax: 38 }, ...input.actuals.slice(1)] });
  assert.equal(legacy.taxableSalesByRate, null);
  assert.equal(legacy.consumptionTax, estimate.consumptionTax);
});

test("retains financial forecasts and gates tax calculations for unsupported years", () => {
  const result = calculateForecast({
    year: 2027,
    lastClosedMonth: 12,
    actuals: allMonths({ sales: 300_000 }),
    tax: { ...supportedTaxInputs, consumptionMethod: "exempt" },
  });
  assert.equal(result.sales, 300_000);
  assert.equal(result.incomeForecast.totalIncome, null);
  assert.equal(result.incomeTax, null);
  assert.equal(result.incomeTaxDetails, null);
  assert.equal(result.donationLimit, null);
  assert.equal(result.donationLimitDetails, null);
  assert.equal(result.consumptionTax, null);
  assert.equal(result.consumptionTaxDetails, null);
});
