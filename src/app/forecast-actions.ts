"use server";

import { redirect } from "next/navigation";
import { DEFAULT_TAX_FORM_AMOUNTS, type MonthAmounts, type TaxInputs } from "@/lib/forecast";
import { closeForecastSession, currentForecastDate, loadForecast, saveMonthlyPlan, saveMonthlyPlanMode, savePreferences, saveSharedClosedMonth } from "@/lib/forecast-store";
import { clearFreeeSession, currentSession, requireSession } from "@/lib/security";

const taxMoneyFields = [
  "salaryGross", "blueDeduction", "socialInsurance", "otherIncomeDeductions", "otherResidentDeductions",
  "residentAdjustmentDeduction", "residentPersonalDeductionDifference", "incomeTaxCredit", "withheldIncomeTax",
  "prepaidIncomeTax", "donationsPaid", "donationsPlanned",
] as const;
const taxAmountDefaults: Partial<Record<(typeof taxMoneyFields)[number], number>> = DEFAULT_TAX_FORM_AMOUNTS;
const planFields = ["sales", "expenses", "salesTax", "deductiblePurchaseTax"] as const;

function integer(form: FormData, field: string, signed = false, errorLocation = "/?notice=invalid-input#settings") {
  const input = form.get(field);
  if (input === "" || input === null) return null;
  const amount = typeof input === "string" && /^-?\d+$/.test(input) ? Number(input) : NaN;
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1_000_000_000_000 || (!signed && amount < 0)) {
    redirect(errorLocation);
  }
  return amount;
}

export async function logout(_form: FormData) {
  const session = await currentSession();
  if (session) await closeForecastSession(session);
  await clearFreeeSession();
  redirect("/?notice=logged-out");
}

export async function saveTax(form: FormData) {
  const session = await requireSession();
  const salesMonth = integer(form, "lastClosedSalesMonth");
  const expenseMonth = integer(form, "lastClosedExpenseMonth");
  const { maxClosedMonth } = await loadForecast(session);
  if ([salesMonth, expenseMonth].some((cutoff) => cutoff !== null && cutoff > maxClosedMonth)) {
    redirect("/?notice=invalid-closed-month#settings");
  }

  const tax: TaxInputs = {};
  for (const key of taxMoneyFields) tax[key] = integer(form, key) ?? taxAmountDefaults[key] ?? null;
  const donation = form.get("donationMethod");
  if (donation === "return" || donation === "one-stop") tax.donationMethod = donation;
  const consumption = form.get("consumptionMethod");
  if (consumption === "general" || consumption === "exempt" || consumption === "simplified" || consumption === "two-tenths") {
    tax.consumptionMethod = consumption;
  }
  const rate = Number(form.get("simplifiedPurchaseRate"));
  if ([0.4, 0.5, 0.6, 0.7, 0.8, 0.9].includes(rate)) tax.simplifiedPurchaseRate = rate;
  tax.twoTenthsEligible = form.get("twoTenthsEligible") === "on";
  await savePreferences(session, tax, undefined, {
    ...(form.has("lastClosedSalesMonth") && { lastClosedSalesMonth: salesMonth }),
    ...(form.has("lastClosedExpenseMonth") && { lastClosedExpenseMonth: expenseMonth }),
  });
  redirect("/?notice=tax-saved#overview");
}

export async function saveClosedMonth(form: FormData) {
  const session = await requireSession();
  const errorLocation = "/?notice=invalid-summary-closed-month#summary";
  if (!form.has("lastClosedMonth")) redirect(errorLocation);
  const month = integer(form, "lastClosedMonth", false, errorLocation);
  if (month !== null && month > currentForecastDate().latestClosedMonth) redirect(errorLocation);
  await saveSharedClosedMonth(session, month);
  redirect("/?notice=closed-month-saved#summary");
}

export async function savePlan(form: FormData) {
  const session = await requireSession();
  const month = integer(form, "month");
  const { lastClosedMonth, lastClosedSalesMonth, lastClosedExpenseMonth, monthlyPlanMode, plans } = await loadForecast(session);
  if (monthlyPlanMode !== "manual") redirect("/?notice=manual-plan-required#monthly-plans");
  if (month === null || month <= lastClosedMonth || month < 1 || month > 12) redirect("/?notice=invalid-plan-month#monthly-plans");
  const previousPlan = plans.find((entry) => entry.month === month);
  const plan: MonthAmounts = { ...previousPlan, month };
  for (const key of planFields) {
    const cutoff = key === "sales" || key === "salesTax" ? lastClosedSalesMonth : lastClosedExpenseMonth;
    if (month > cutoff) plan[key] = integer(form, key, true);
  }
  await saveMonthlyPlan(session, month, planFields.some((key) => plan[key] != null) ? plan : null);
  redirect("/?notice=plan-saved#monthly-plans");
}

export async function setPlanMode(form: FormData) {
  const session = await requireSession();
  const selection = form.get("monthlyPlanMode");
  if (selection !== "trend" && selection !== "manual") redirect("/#monthly-plans");
  await saveMonthlyPlanMode(session, selection);
  redirect(`/?notice=plan-mode-${selection}#monthly-plans`);
}
