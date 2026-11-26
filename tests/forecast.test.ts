import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateForecast,
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
  assert.equal(result.months[5].forecast.sales, 300);
  assert.equal(result.months[5].sources.sales, "average");
  assert.equal(result.sales, 4_100);
  assert.equal(result.expenses, 300);
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
  assert.equal(result.incomeTax, null);
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

test("computes estimated annual income tax and final amount after withholding and prepayments", () => {
  const result = calculateForecast({
    year: FORECAST_YEAR,
    lastClosedMonth: 12,
    actuals: allMonths({ sales: 7_120_000 }),
    tax: { ...supportedTaxInputs, withheldIncomeTax: 10_000, prepaidIncomeTax: 50_000 },
  });
  // 国税庁の課税所得650万円の例（所得税872,500円）に復興特別所得税を加算。
  assert.equal(result.incomeTax, 890_822);
  assert.equal(result.incomeTaxSettlement, 830_800);
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
});

test("consumption tax uses qualified credits, deemed rates and confirmed eligibility", () => {
  const input = {
    year: FORECAST_YEAR,
    lastClosedMonth: 12,
    actuals: allMonths({ salesTax: 1_000_000, deductiblePurchaseTax: 600_000 }),
  };
  assert.equal(calculateForecast({ ...input, tax: { consumptionMethod: "general" } }).consumptionTax, 400_000);
  assert.equal(calculateForecast({
    ...input, tax: { consumptionMethod: "simplified", simplifiedPurchaseRate: 0.7 },
  }).consumptionTax, 300_000);
  assert.equal(calculateForecast({ ...input, tax: { consumptionMethod: "two-tenths" } }).consumptionTax, null);
  assert.equal(calculateForecast({
    ...input, tax: { consumptionMethod: "two-tenths", twoTenthsEligible: true },
  }).consumptionTax, 200_000);
  assert.equal(calculateForecast({
    ...input, actuals: allMonths({ salesTax: 50_000, deductiblePurchaseTax: 150_000 }),
    tax: { consumptionMethod: "general" },
  }).consumptionTax, -100_000);
});

test("retains financial forecasts and gates tax calculations for unsupported years", () => {
  const result = calculateForecast({
    year: 2027,
    lastClosedMonth: 12,
    actuals: allMonths({ sales: 300_000 }),
    tax: { ...supportedTaxInputs, consumptionMethod: "exempt" },
  });
  assert.equal(result.sales, 300_000);
  assert.equal(result.incomeTax, null);
  assert.equal(result.donationLimit, null);
  assert.equal(result.consumptionTax, null);
});
