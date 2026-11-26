import "server-only";
import { randomUUID } from "node:crypto";
import { FORECAST_YEAR, type MonthAmounts, type MonthlyPlanMode, type TaxInputs } from "./forecast";
import { currentTokyoDate } from "./forecast-year";
import type { FreeeAccountingSnapshot, FreeeTokens } from "./freee";
import type { FreeeSession } from "./security";

export function currentForecastDate(forecastYear: number = FORECAST_YEAR) {
  const date = currentTokyoDate();
  const year = Number(date.substring(0, 4));
  const month = Number(date.substring(5, 7));
  return {
    latestClosedMonth: year < forecastYear ? 0 : year > forecastYear ? 12 : month - 1,
    throughMonth: year < forecastYear ? 0 : year > forecastYear ? 12 : month,
    throughDate: year > forecastYear ? `${forecastYear}-12-31` : date,
  };
}

interface Preferences {
  tax?: TaxInputs;
  plans: Record<string, MonthAmounts | null>;
  monthlyPlanMode?: MonthlyPlanMode;
  lastClosedMonth: number | null;
  lastClosedSalesMonth?: number | null;
  lastClosedExpenseMonth?: number | null;
}

type Snapshot = FreeeAccountingSnapshot & { closedThroughMonth: number };
type Accounting = { snapshot: Snapshot; syncedAt: string };

interface AnnualForecast {
  preferences: Preferences;
  sync?: { id: string; expiresAt: number };
  accounting?: Accounting;
}

interface ForecastSession extends AnnualForecast {
  closed?: false;
  companyId: number;
  expiresAt: number;
  otherYears?: Map<number, AnnualForecast>;
  tokens?: FreeeTokens;
  refresh?: Promise<FreeeTokens>;
}

type SessionEntry = ForecastSession | { closed: true; expiresAt: number };

// Keep state shared across module reloads within this server process.
const server = globalThis as typeof globalThis & { kagecoForecastSessions?: Map<string, SessionEntry> };
const sessions = server.kagecoForecastSessions ??= new Map();

function getForecastSession(session: FreeeSession, create = true): ForecastSession | undefined {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= now) sessions.delete(id);
  }
  if (session.expiresAt <= now) return undefined;

  const existing = sessions.get(session.id);
  if (existing) {
    return !existing.closed && existing.companyId === session.companyId && existing.expiresAt === session.expiresAt
      ? existing
      : undefined;
  }
  if (!create) return undefined;

  const entry: ForecastSession = {
    companyId: session.companyId,
    expiresAt: session.expiresAt,
    preferences: { plans: {}, lastClosedMonth: null },
  };
  sessions.set(session.id, entry);
  return entry;
}

function getAnnualForecast(entry: ForecastSession | undefined, year: number, create = true): AnnualForecast | undefined {
  if (!entry) return undefined;
  // Keep the original year's data, including any sync in flight, on existing sessions.
  if (year === FORECAST_YEAR) return entry;
  const existing = entry.otherYears?.get(year);
  if (existing || !create) return existing;
  const forecast: AnnualForecast = { preferences: { plans: {}, lastClosedMonth: null } };
  (entry.otherYears ??= new Map()).set(year, forecast);
  return forecast;
}

export async function savePreferences(
  session: FreeeSession,
  tax: TaxInputs,
  lastClosedMonth?: number | null,
  cutoffOverrides: Pick<Preferences, "lastClosedSalesMonth" | "lastClosedExpenseMonth"> = {},
  year: number = FORECAST_YEAR,
) {
  const entry = getAnnualForecast(getForecastSession(session), year);
  if (!entry) return;
  Object.assign(entry.preferences, { tax }, cutoffOverrides);
  if (lastClosedMonth !== undefined) entry.preferences.lastClosedMonth = lastClosedMonth;
}

export async function saveSharedClosedMonth(session: FreeeSession, lastClosedMonth: number | null, year: number = FORECAST_YEAR) {
  const entry = getAnnualForecast(getForecastSession(session), year);
  if (entry) Object.assign(entry.preferences, {
    lastClosedMonth,
    lastClosedSalesMonth: null,
    lastClosedExpenseMonth: null,
  });
}

export async function saveClosedMonthOverrides(
  session: FreeeSession, lastClosedSalesMonth: number | null, lastClosedExpenseMonth: number | null, year: number = FORECAST_YEAR,
) {
  const entry = getAnnualForecast(getForecastSession(session), year);
  if (entry) Object.assign(entry.preferences, { lastClosedSalesMonth, lastClosedExpenseMonth });
}

export async function saveMonthlyPlan(session: FreeeSession, month: number, plan: MonthAmounts | null, year: number = FORECAST_YEAR) {
  const stored = getAnnualForecast(getForecastSession(session), year)?.preferences;
  if (!stored) return;
  stored.plans[month] = plan;
  stored.monthlyPlanMode ??= "manual";
}

export async function saveMonthlyPlanMode(session: FreeeSession, monthlyPlanMode: MonthlyPlanMode, year: number = FORECAST_YEAR) {
  const entry = getAnnualForecast(getForecastSession(session), year);
  if (entry) entry.preferences.monthlyPlanMode = monthlyPlanMode;
}

export function canUseAccessToken(tokens: FreeeTokens | null | undefined) {
  return Boolean(tokens && tokens.expiresAt > Date.now() + 120_000);
}

export async function loadForecast(session: FreeeSession, year: number = FORECAST_YEAR) {
  const entry = getForecastSession(session);
  const annual = getAnnualForecast(entry, year, false);
  const stored = annual?.preferences;
  const accounting = annual?.accounting;
  const { latestClosedMonth: defaultClosedMonth } = currentForecastDate(year);
  const maxClosedMonth = Math.min(accounting?.snapshot.closedThroughMonth ?? 0, defaultClosedMonth);
  const fallbackClosedMonth = Math.min(stored?.lastClosedMonth ?? defaultClosedMonth, defaultClosedMonth);
  const lastClosedSalesMonth = stored?.lastClosedSalesMonth == null
    ? fallbackClosedMonth : Math.min(stored.lastClosedSalesMonth, maxClosedMonth);
  const lastClosedExpenseMonth = stored?.lastClosedExpenseMonth == null
    ? fallbackClosedMonth : Math.min(stored.lastClosedExpenseMonth, maxClosedMonth);
  const lastClosedMonth = Math.min(lastClosedSalesMonth, lastClosedExpenseMonth);
  const plans = Object.values(stored?.plans ?? {}).filter((plan) => plan !== null);
  const hasSavedFuturePlan = plans.some((plan) => plan.month > lastClosedMonth);
  const monthlyPlanMode: MonthlyPlanMode = stored?.monthlyPlanMode ?? (hasSavedFuturePlan ? "manual" : "trend");

  const settings = accounting?.snapshot.taxSettings;
  const actuals = (accounting?.snapshot.months ?? []).map((row) => {
    if (row.month <= maxClosedMonth) return row;
    return {
      ...row,
      ...(row.month <= lastClosedSalesMonth && { sales: null, salesTax: null, taxableSalesByRate: null }),
      ...(row.month <= lastClosedExpenseMonth && { expenses: null, deductiblePurchaseTax: null }),
    };
  });
  const tax: TaxInputs = stored?.tax ?? {};
  const simplifiedRates = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
  return {
    actuals,
    plans,
    monthlyPlanMode,
    tax: {
      ...tax,
      consumptionMethod: tax.consumptionMethod ?? settings?.method ?? undefined,
      simplifiedPurchaseRate: tax.simplifiedPurchaseRate ?? (settings?.simpleBusinessCategory
        ? simplifiedRates[settings.simpleBusinessCategory - 1] : undefined),
    },
    lastClosedMonth,
    lastClosedSalesMonth,
    lastClosedExpenseMonth,
    lastClosedMonthSetting: stored?.lastClosedMonth ?? null,
    lastClosedSalesMonthSetting: stored?.lastClosedSalesMonth ?? null,
    lastClosedExpenseMonthSetting: stored?.lastClosedExpenseMonth ?? null,
    defaultClosedMonth,
    maxClosedMonth,
    connected: entry !== undefined,
    canSyncWithoutRefresh: canUseAccessToken(entry?.tokens),
    companyName: entry ? session.companyName : null,
    syncedAt: accounting?.syncedAt ?? null,
    consumptionMethodConfirmed: tax.consumptionMethod !== undefined,
  };
}

export async function closeForecastSession(session: FreeeSession) {
  const entry = getForecastSession(session);
  if (!entry) return null;

  // Reject pending writes immediately, even while a token refresh completes.
  sessions.set(session.id, { closed: true, expiresAt: entry.expiresAt });
  if (entry.refresh) await entry.refresh.catch(() => undefined);
  return entry.tokens ?? null;
}

export async function beginSync(session: FreeeSession, year: number = FORECAST_YEAR) {
  const entry = getAnnualForecast(getForecastSession(session), year);
  const now = Date.now();
  if (!entry || (entry.sync && entry.sync.expiresAt > now)) return null;
  const id = randomUUID();
  entry.sync = { id, expiresAt: now + 180_000 };
  return id;
}

export async function finishSync(session: FreeeSession, id: string, snapshot?: Snapshot, year: number = FORECAST_YEAR) {
  const entry = getForecastSession(session, false);
  const annual = getAnnualForecast(entry, year, false);
  if (!entry || annual?.sync?.id !== id) return false;
  annual.sync = undefined;
  if (!snapshot || snapshot.companyId !== entry.companyId || snapshot.year !== year) return false;
  annual.accounting = { snapshot, syncedAt: new Date().toISOString() };
  return true;
}

export async function activeTokens(session: FreeeSession, fallback: FreeeTokens | null, refresh: (tokens: FreeeTokens) => Promise<FreeeTokens>) {
  const entry = getForecastSession(session);
  if (!entry) return null;
  if (fallback?.companyId != null && fallback.companyId !== entry.companyId) throw new Error("freee company changed");
  if (fallback && (!entry.tokens || fallback.expiresAt > entry.tokens.expiresAt)) entry.tokens = fallback;
  const tokens = entry.tokens;
  if (!tokens || canUseAccessToken(tokens)) return tokens ?? null;

  entry.refresh ??= Promise.resolve().then(async () => {
    const updated = await refresh(tokens);
    if (updated.companyId !== null && updated.companyId !== entry.companyId) throw new Error("freee company changed");
    entry.tokens = updated;
    return updated;
  }).finally(() => {
    entry.refresh = undefined;
  });
  const updated = await entry.refresh;
  return getForecastSession(session, false) === entry ? updated : null;
}
