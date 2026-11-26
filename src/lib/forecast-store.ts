import "server-only";
import { randomUUID } from "node:crypto";
import { FORECAST_YEAR, type MonthAmounts, type MonthlyPlanMode, type TaxInputs } from "./forecast";
import type { FreeeAccountingSnapshot, FreeeTokens } from "./freee";

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
  preferences: { real: Preferences };
  oauthAttempts: Map<string, { session: string; expiresAt: number }>;
  connection?: Connection;
}

// Keep state shared across module reloads within this server process.
const server = globalThis as typeof globalThis & { kagecoForecastState?: ForecastState };
const state: ForecastState = server.kagecoForecastState ??= {
  preferences: {
    real: { plans: {}, lastClosedMonth: null },
  },
  oauthAttempts: new Map(),
};

export async function savePreferences(tax: TaxInputs, lastClosedMonth: number | null) {
  Object.assign(state.preferences.real, { tax, lastClosedMonth });
}

export async function saveMonthlyPlan(month: number, plan: MonthAmounts | null) {
  const stored = state.preferences.real;
  stored.plans[month] = plan;
  stored.monthlyPlanMode ??= "manual";
}

export async function saveMonthlyPlanMode(monthlyPlanMode: MonthlyPlanMode) {
  state.preferences.real.monthlyPlanMode = monthlyPlanMode;
}

export async function connectionDetails() {
  return state.connection?.details;
}

export async function loadForecast() {
  const stored = state.preferences.real;
  const connection = state.connection;
  const accounting = connection?.accounting;
  const maxClosedMonth = Math.min(accounting?.snapshot.closedThroughMonth ?? 0, currentForecastDate().latestClosedMonth);
  const lastClosedMonth = Math.min(stored.lastClosedMonth ?? maxClosedMonth, maxClosedMonth);
  const plans = Object.values(stored.plans).filter((plan) => plan !== null);
  const hasSavedFuturePlan = plans.some((plan) => plan.month > lastClosedMonth);
  const monthlyPlanMode: MonthlyPlanMode = stored.monthlyPlanMode ?? (hasSavedFuturePlan ? "manual" : "trend");

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
