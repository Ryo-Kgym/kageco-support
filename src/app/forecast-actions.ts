"use server";

import { redirect } from "next/navigation";
import { DEFAULT_TAX_FORM_AMOUNTS, type MonthAmounts, type TaxInputs } from "@/lib/forecast";
import { loadForecast, saveMonthlyPlan, saveMonthlyPlanMode, savePreferences } from "@/lib/forecast-store";
import { getMode, requireSession, signIn, signOut, switchMode } from "@/lib/security";

const taxMoneyFields = [
  "salaryGross", "blueDeduction", "socialInsurance", "otherIncomeDeductions", "otherResidentDeductions",
  "residentAdjustmentDeduction", "residentPersonalDeductionDifference", "incomeTaxCredit", "withheldIncomeTax",
  "prepaidIncomeTax", "donationsPaid", "donationsPlanned",
] as const;
const taxAmountDefaults: Partial<Record<(typeof taxMoneyFields)[number], number>> = DEFAULT_TAX_FORM_AMOUNTS;
const planFields = ["sales", "expenses", "salesTax", "deductiblePurchaseTax"] as const;

function integer(form: FormData, field: string, signed = false) {
  const input = form.get(field);
  if (input === "" || input === null) return null;
  const amount = typeof input === "string" && /^-?\d+$/.test(input) ? Number(input) : NaN;
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > 1_000_000_000_000 || (!signed && amount < 0)) {
    redirect("/?notice=invalid-input#settings");
  }
  return amount;
}

export async function login(form: FormData) {
  const password = form.get("password");
  if (typeof password !== "string" || !(await signIn(password))) redirect("/?notice=login-failed");
  redirect("/");
}

export async function logout(_form: FormData) {
  await requireSession();
  await signOut();
  redirect("/");
}

export async function setDemo(form: FormData) {
  await requireSession();
  const mode = form.get("mode");
  if (mode === "real" || mode === "demo") await switchMode(mode);
  redirect("/");
}

export async function saveTax(mode: "real" | "demo", form: FormData) {
  await requireSession();
  if (mode !== await getMode()) redirect("/?notice=mode-changed#settings");
  const month = integer(form, "lastClosedMonth");
  const { maxClosedMonth } = await loadForecast(mode);
  if (month !== null && month > maxClosedMonth) redirect("/?notice=invalid-closed-month#settings");

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
  await savePreferences(mode, tax, month);
  redirect("/?notice=tax-saved#settings");
}

export async function savePlan(mode: "real" | "demo", form: FormData) {
  await requireSession();
  if (mode !== await getMode()) redirect("/?notice=mode-changed#monthly-plans");
  const month = integer(form, "month");
  const { lastClosedMonth, monthlyPlanMode } = await loadForecast(mode);
  if (monthlyPlanMode !== "manual") redirect("/?notice=manual-plan-required#monthly-plans");
  if (month === null || month <= lastClosedMonth || month < 1 || month > 12) redirect("/?notice=invalid-plan-month#monthly-plans");
  const plan: MonthAmounts = { month };
  for (const key of planFields) plan[key] = integer(form, key, true);
  await saveMonthlyPlan(mode, month, planFields.some((key) => plan[key] !== null) ? plan : null);
  redirect("/?notice=plan-saved#monthly-plans");
}

export async function setPlanMode(mode: "real" | "demo", form: FormData) {
  await requireSession();
  if (mode !== await getMode()) redirect("/?notice=mode-changed#monthly-plans");
  const selection = form.get("monthlyPlanMode");
  if (selection !== "trend" && selection !== "manual") redirect("/#monthly-plans");
  await saveMonthlyPlanMode(mode, selection);
  redirect(`/?notice=plan-mode-${selection}#monthly-plans`);
}
