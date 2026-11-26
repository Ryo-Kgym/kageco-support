import "server-only";
import { randomUUID } from "node:crypto";
import { FORECAST_YEAR, type MonthAmounts, type MonthlyPlanMode, type TaxInputs } from "./forecast";
import type { FreeeAccountingSnapshot, FreeeTokens } from "./freee";

type Mode = "real" | "demo";

export function currentForecastDate() {
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const year = Number(date.substring(0, 4));
  const month = Number(date.substring(5, 7));
  return {
    latestClosedMonth: year < FORECAST_YEAR ? 0 : year > FORECAST_YEAR ? 12 : month - 1,
    throughMonth: year < FORECAST_YEAR ? 0 : year > FORECAST_YEAR ? 12 : month,
    throughDate: year > FORECAST_YEAR ? `${FORECAST_YEAR}-12-31` : date,
  };
}

const demoTax: TaxInputs = {
  salaryGross: 0, blueDeduction: 650_000, socialInsurance: 580_000,
  otherIncomeDeductions: 84_000, otherResidentDeductions: 84_000,
  residentPersonalDeductionDifference: 0, incomeTaxCredit: 0,
  withheldIncomeTax: 0, prepaidIncomeTax: 120_000,
  donationsPaid: 38_000, donationsPlanned: 20_000, donationMethod: "return",
  consumptionMethod: "general",
};

const demoMonths: MonthAmounts[] = [
  [660_000, 188_000], [740_000, 207_000], [716_000, 245_000], [845_000, 210_000],
  [782_000, 306_000], [960_000, 238_000], [885_000, 201_000], [815_000, 263_000],
  [915_000, 235_000],
].map(([sales, expenses], index) => ({
  month: index + 1, sales, expenses,
  salesTax: Math.round(sales * 0.1), deductiblePurchaseTax: Math.round(expenses * 0.08),
}));

const demoPlans: Record<string, MonthAmounts> = {
  "12": { month: 12, sales: 1_034_000, expenses: 312_000, salesTax: 103_400, deductiblePurchaseTax: 24_960 },
};

interface Preferences {
  tax?: TaxInputs;
  plans: Record<string, MonthAmounts | null>;
  monthlyPlanMode?: MonthlyPlanMode;
  lastClosedMonth: number | null;
}

type ConnectionDetails = { company_id: number; company_name: string; version: string };
type Snapshot = FreeeAccountingSnapshot & { closedThroughMonth: number };

interface Connection {
  details: ConnectionDetails;
  tokens: FreeeTokens;
  refresh?: Promise<FreeeTokens>;
  sync?: { id: string; expiresAt: number };
  accounting?: { snapshot: Snapshot; syncedAt: string };
}

interface ForecastState {
  preferences: Record<Mode, Preferences>;
  oauthAttempts: Map<string, { session: string; expiresAt: number }>;
  connection?: Connection;
}

// Keep state shared across module reloads within this server process.
const server = globalThis as typeof globalThis & { kagecoForecastState?: ForecastState };
const state: ForecastState = server.kagecoForecastState ??= {
  preferences: {
    real: { plans: {}, lastClosedMonth: null },
    demo: { plans: {}, lastClosedMonth: null },
  },
  oauthAttempts: new Map(),
};

export async function savePreferences(mode: Mode, tax: TaxInputs, lastClosedMonth: number | null) {
  Object.assign(state.preferences[mode], { tax, lastClosedMonth });
}

export async function saveMonthlyPlan(mode: Mode, month: number, plan: MonthAmounts | null) {
  const stored = state.preferences[mode];
  stored.plans[month] = plan;
  stored.monthlyPlanMode ??= "manual";
}

export async function saveMonthlyPlanMode(mode: Mode, monthlyPlanMode: MonthlyPlanMode) {
  state.preferences[mode].monthlyPlanMode = monthlyPlanMode;
}

export async function connectionDetails() {
  return state.connection?.details;
}

export async function loadForecast(mode: Mode) {
  const stored = state.preferences[mode];
  const connection = state.connection;
  const accounting = connection?.accounting;
  const maxClosedMonth = mode === "demo" ? 9
    : Math.min(accounting?.snapshot.closedThroughMonth ?? 0, currentForecastDate().latestClosedMonth);
  const lastClosedMonth = Math.min(stored.lastClosedMonth ?? maxClosedMonth, maxClosedMonth);
  const planEntries = mode === "demo" ? { ...demoPlans, ...stored.plans } : stored.plans;
  const plans = Object.values(planEntries).filter((plan) => plan !== null);
  const hasSavedFuturePlan = Object.values(stored.plans).some((plan) => plan !== null && plan.month > lastClosedMonth);
  const monthlyPlanMode: MonthlyPlanMode = stored.monthlyPlanMode ?? (hasSavedFuturePlan ? "manual" : "trend");

  if (mode === "demo") {
    return {
      actuals: demoMonths,
      plans,
      monthlyPlanMode,
      tax: stored.tax ?? demoTax,
      lastClosedMonth,
      lastClosedMonthSetting: stored.lastClosedMonth,
      maxClosedMonth,
      consumptionMethodConfirmed: true,
      companyName: null,
      syncedAt: null,
    };
  }

  const settings = accounting?.snapshot.taxSettings;
  const tax: TaxInputs = stored.tax ?? {};
  const simplifiedRates = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
  return {
    actuals: accounting?.snapshot.months ?? [],
    plans,
    monthlyPlanMode,
    tax: {
      ...tax,
      consumptionMethod: tax.consumptionMethod ?? settings?.method ?? undefined,
      simplifiedPurchaseRate: tax.simplifiedPurchaseRate ?? (settings?.simpleBusinessCategory
        ? simplifiedRates[settings.simpleBusinessCategory - 1] : undefined),
    },
    lastClosedMonth,
    lastClosedMonthSetting: stored.lastClosedMonth,
    maxClosedMonth,
    companyName: connection?.details.company_name ?? null,
    syncedAt: accounting?.syncedAt ?? null,
    consumptionMethodConfirmed: tax.consumptionMethod !== undefined,
  };
}

export async function saveOAuthAttempt(nonce: string, session: string) {
  const now = Date.now();
  for (const [key, attempt] of state.oauthAttempts) {
    if (attempt.expiresAt <= now) state.oauthAttempts.delete(key);
  }
  state.oauthAttempts.set(nonce, { session, expiresAt: now + 600_000 });
}

export async function consumeOAuthAttempt(nonce: string, session: string) {
  const attempt = state.oauthAttempts.get(nonce);
  if (!attempt || attempt.session !== session) return false;
  state.oauthAttempts.delete(nonce);
  return attempt.expiresAt > Date.now();
}

export async function saveConnection(companyId: number, name: string, tokens: FreeeTokens) {
  const previous = state.connection;
  if (previous && previous.details.company_id !== companyId) return false;
  state.connection = {
    details: { company_id: companyId, company_name: name, version: randomUUID() },
    tokens,
    accounting: previous?.accounting,
  };
  return true;
}

export async function beginSync(version: string) {
  const connection = state.connection;
  const now = Date.now();
  if (!connection || connection.details.version !== version || (connection.sync && connection.sync.expiresAt > now)) return null;
  const id = randomUUID();
  connection.sync = { id, expiresAt: now + 180_000 };
  return id;
}

export async function finishSync(id: string, version: string, snapshot?: Snapshot) {
  const connection = state.connection;
  if (!connection || connection.details.version !== version || connection.sync?.id !== id) return false;
  connection.sync = undefined;
  if (!snapshot || snapshot.companyId !== connection.details.company_id || snapshot.year !== FORECAST_YEAR) return false;
  connection.accounting = { snapshot, syncedAt: new Date().toISOString() };
  return true;
}

export async function activeTokens(version: string, refresh: (tokens: FreeeTokens) => Promise<FreeeTokens>) {
  const connection = state.connection;
  if (!connection || connection.details.version !== version) throw new Error("freee connection changed");
  if (connection.tokens.expiresAt > Date.now() + 120_000) return connection.tokens;

  connection.refresh ??= Promise.resolve().then(async () => {
    const updated = await refresh(connection.tokens);
    if (state.connection !== connection) throw new Error("freee connection changed");
    if (updated.companyId !== null && updated.companyId !== connection.details.company_id) throw new Error("freee company changed");
    connection.tokens = updated;
    return updated;
  }).finally(() => {
    connection.refresh = undefined;
  });
  return connection.refresh;
}
