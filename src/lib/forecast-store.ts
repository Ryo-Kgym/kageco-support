import "server-only";
import { randomUUID } from "node:crypto";
import { FORECAST_YEAR, type MonthAmounts, type MonthlyPlanMode, type TaxInputs } from "./forecast";
import type { FreeeAccountingSnapshot, FreeeTokens } from "./freee";
import type { FreeeSession } from "./security";

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

type Snapshot = FreeeAccountingSnapshot & { closedThroughMonth: number };
type Accounting = { snapshot: Snapshot; syncedAt: string };

interface ForecastSession {
  closed?: false;
  companyId: number;
  expiresAt: number;
  preferences: Preferences;
  tokens?: FreeeTokens;
  refresh?: Promise<FreeeTokens>;
  sync?: { id: string; expiresAt: number };
  accounting?: Accounting;
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

export async function savePreferences(session: FreeeSession, tax: TaxInputs, lastClosedMonth: number | null) {
  const entry = getForecastSession(session);
  if (entry) Object.assign(entry.preferences, { tax, lastClosedMonth });
}

export async function saveMonthlyPlan(session: FreeeSession, month: number, plan: MonthAmounts | null) {
  const stored = getForecastSession(session)?.preferences;
  if (!stored) return;
  stored.plans[month] = plan;
  stored.monthlyPlanMode ??= "manual";
}

export async function saveMonthlyPlanMode(session: FreeeSession, monthlyPlanMode: MonthlyPlanMode) {
  const entry = getForecastSession(session);
  if (entry) entry.preferences.monthlyPlanMode = monthlyPlanMode;
}

export function canUseAccessToken(tokens: FreeeTokens | null | undefined) {
  return Boolean(tokens && tokens.expiresAt > Date.now() + 120_000);
}

export async function loadForecast(session: FreeeSession) {
  const entry = getForecastSession(session);
  const stored = entry?.preferences;
  const accounting = entry?.accounting;
  const maxClosedMonth = Math.min(accounting?.snapshot.closedThroughMonth ?? 0, currentForecastDate().latestClosedMonth);
  const lastClosedMonth = Math.min(stored?.lastClosedMonth ?? maxClosedMonth, maxClosedMonth);
  const plans = Object.values(stored?.plans ?? {}).filter((plan) => plan !== null);
  const hasSavedFuturePlan = plans.some((plan) => plan.month > lastClosedMonth);
  const monthlyPlanMode: MonthlyPlanMode = stored?.monthlyPlanMode ?? (hasSavedFuturePlan ? "manual" : "trend");

  const settings = accounting?.snapshot.taxSettings;
  const tax: TaxInputs = stored?.tax ?? {};
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
    lastClosedMonthSetting: stored?.lastClosedMonth ?? null,
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

export async function beginSync(session: FreeeSession) {
  const entry = getForecastSession(session);
  const now = Date.now();
  if (!entry || (entry.sync && entry.sync.expiresAt > now)) return null;
  const id = randomUUID();
  entry.sync = { id, expiresAt: now + 180_000 };
  return id;
}

export async function finishSync(session: FreeeSession, id: string, snapshot?: Snapshot) {
  const entry = getForecastSession(session, false);
  if (entry?.sync?.id !== id) return false;
  entry.sync = undefined;
  if (!snapshot || snapshot.companyId !== entry.companyId || snapshot.year !== FORECAST_YEAR) return false;
  entry.accounting = { snapshot, syncedAt: new Date().toISOString() };
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
