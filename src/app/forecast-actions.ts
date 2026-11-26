"use server";

import { redirect } from "next/navigation";
import { DEFAULT_TAX_FORM_AMOUNTS, itemizedDeductionsForYear, MAX_MEDICAL_EXPENSE_DEDUCTION, type MonthAmounts, type TaxInputs } from "@/lib/forecast";
import { closeForecastSession, currentForecastDate, loadForecast, saveClosedMonthOverrides, saveMonthlyPlan, saveMonthlyPlanMode, savePreferences, saveSharedClosedMonth } from "@/lib/forecast-store";
import { forecastLocation, isForecastYear } from "@/lib/forecast-year";
import { clearFreeeSession, currentSession, requireSession } from "@/lib/security";

const taxMoneyFields = [
  "salaryGross", "blueDeduction", "socialInsurance", "smallBusinessMutualAidDeduction", "medicalExpenseDeduction",
  "casualtyLossDeduction", "otherIncomeDeductions", "otherResidentDeductions", "housingLoanTaxCredit",
  "residentAdjustmentDeduction", "residentPersonalDeductionDifference", "incomeTaxCredit", "withheldIncomeTax",
  "prepaidIncomeTax", "donationsPaid", "donationsPlanned", "otherEligibleDonations",
] as const;
const taxAmountDefaults: Partial<Record<(typeof taxMoneyFields)[number], number>> = DEFAULT_TAX_FORM_AMOUNTS;
const planFields = ["sales", "expenses", "salesTax", "deductiblePurchaseTax"] as const;

function integer(form: FormData, field: string, errorLocation: string, signed = false) {
  const input = form.get(field);
  if (input === "" || input === null) return null;
  const amount = typeof input === "string" && /^-?\d+$/.test(input) ? Number(input) : NaN;
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1_000_000_000_000 || (!signed && amount < 0)) {
    redirect(errorLocation);
  }
  return amount;
}

function submittedDeductions(form: FormData, year: number, field: "incomeDeductions" | "residentDeductions", errorLocation: string) {
  const deductions = itemizedDeductionsForYear(year);
  return Object.fromEntries(deductions.map(({ key }) => [key, integer(form, `${field}.${key}`, errorLocation) ?? 0]));
}

function requireYearSession(year: number) {
  if (!isForecastYear(year)) redirect("/");
  return requireSession();
}

export async function logout(_form: FormData) {
  const session = await currentSession();
  if (session) await closeForecastSession(session);
  await clearFreeeSession();
  redirect("/?notice=logged-out");
}

export async function saveTax(year: number, form: FormData) {
  const session = await requireYearSession(year);
  const errorLocation = forecastLocation(year, "invalid-input", "settings");
  const tax: TaxInputs = {};
  for (const key of taxMoneyFields) tax[key] = integer(form, key, errorLocation) ?? taxAmountDefaults[key] ?? null;
  if ((tax.medicalExpenseDeduction ?? 0) > MAX_MEDICAL_EXPENSE_DEDUCTION) {
    redirect(forecastLocation(year, "invalid-medical-expense-deduction", "overview"));
  }
  tax.incomeDeductions = submittedDeductions(form, year, "incomeDeductions", errorLocation);
  tax.residentDeductions = submittedDeductions(form, year, "residentDeductions", errorLocation);
  if (year === 2024) tax.fixedTaxReductionDependents = integer(form, "fixedTaxReductionDependents", errorLocation) ?? 0;
  tax.residentDependentCount = integer(form, "residentDependentCount", errorLocation) ?? 0;
  tax.residentPersonalExemption = form.get("residentPersonalExemption") === "on";
  const donation = form.get("donationMethod");
  if ((tax.otherEligibleDonations ?? 0) > 0) tax.donationMethod = "return";
  else if (donation === "return" || donation === "one-stop" || donation === "") tax.donationMethod = donation || null;
  const consumption = form.get("consumptionMethod");
  if (consumption === "general" || consumption === "exempt" || consumption === "simplified" || consumption === "two-tenths") {
    tax.consumptionMethod = consumption;
  }
  const rate = Number(form.get("simplifiedPurchaseRate"));
  if ([0.4, 0.5, 0.6, 0.7, 0.8, 0.9].includes(rate)) tax.simplifiedPurchaseRate = rate;
  tax.twoTenthsEligible = form.get("twoTenthsEligible") === "on";
  await savePreferences(session, tax, undefined, undefined, year);
  redirect(forecastLocation(year, "tax-saved", "overview"));
}

export async function saveClosedMonth(year: number, form: FormData) {
  const session = await requireYearSession(year);
  const errorLocation = forecastLocation(year, "invalid-summary-closed-month", "summary");
  if (!form.has("lastClosedMonth")) redirect(errorLocation);
  const month = integer(form, "lastClosedMonth", errorLocation);
  if (month !== null && month > currentForecastDate(year).latestClosedMonth) redirect(errorLocation);
  await saveSharedClosedMonth(session, month, year);
  redirect(forecastLocation(year, "closed-month-saved", "summary"));
}

export async function saveIndividualClosedMonths(year: number, form: FormData) {
  const session = await requireYearSession(year);
  const errorLocation = forecastLocation(year, "invalid-closed-month", "aggregation-period");
  if (!form.has("lastClosedSalesMonth") || !form.has("lastClosedExpenseMonth")) redirect(errorLocation);

  const salesMonth = integer(form, "lastClosedSalesMonth", errorLocation);
  const expenseMonth = integer(form, "lastClosedExpenseMonth", errorLocation);
  const { maxClosedMonth } = await loadForecast(session, year);
  if ([salesMonth, expenseMonth].some((month) => month !== null && month > maxClosedMonth)) redirect(errorLocation);

  await saveClosedMonthOverrides(session, salesMonth, expenseMonth, year);
  redirect(forecastLocation(year, "individual-closed-months-saved", "aggregation-period"));
}

export async function savePlan(year: number, form: FormData) {
  const session = await requireYearSession(year);
  const errorLocation = forecastLocation(year, "invalid-input", "monthly-plans");
  const month = integer(form, "month", errorLocation);
  const { lastClosedMonth, lastClosedSalesMonth, lastClosedExpenseMonth, monthlyPlanMode, plans } = await loadForecast(session, year);
  if (monthlyPlanMode !== "manual") redirect(forecastLocation(year, "manual-plan-required", "monthly-plans"));
  if (month === null || month <= lastClosedMonth || month < 1 || month > 12) {
    redirect(forecastLocation(year, "invalid-plan-month", "monthly-plans"));
  }
  const previousPlan = plans.find((entry) => entry.month === month);
  const plan: MonthAmounts = { ...previousPlan, month };
  for (const key of planFields) {
    const cutoff = key === "sales" || key === "salesTax" ? lastClosedSalesMonth : lastClosedExpenseMonth;
    if (month > cutoff) plan[key] = integer(form, key, errorLocation, true);
  }
  await saveMonthlyPlan(session, month, planFields.some((key) => plan[key] != null) ? plan : null, year);
  redirect(forecastLocation(year, "plan-saved", "monthly-plans"));
}

export async function setPlanMode(year: number, form: FormData) {
  const session = await requireYearSession(year);
  const selection = form.get("monthlyPlanMode");
  if (selection !== "trend" && selection !== "manual") redirect(forecastLocation(year, undefined, "monthly-plans"));
  await saveMonthlyPlanMode(session, selection, year);
  redirect(forecastLocation(year, `plan-mode-${selection}`, "monthly-plans"));
}
