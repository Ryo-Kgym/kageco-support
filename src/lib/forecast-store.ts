import "server-only";
import { randomUUID } from "node:crypto";
import { database } from "./database";
import { FORECAST_YEAR, type MonthAmounts, type TaxInputs } from "./forecast";
import type { FreeeAccountingSnapshot, FreeeTokens } from "./freee";
import { decryptTokenValues, encryptTokenValues, sha256 } from "./security";

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

interface PreferencesRow {
  tax: TaxInputs;
  plans: Record<string, MonthAmounts | null>;
  last_closed_month: number | null;
}

async function preferences(mode: Mode) {
  const db = await database();
  const [row] = await db.query<PreferencesRow>(
    `SELECT tax, plans, last_closed_month FROM forecast_preferences WHERE year = $1 AND mode = $2`,
    [FORECAST_YEAR, mode],
  );
  return row;
}

export async function savePreferences(mode: Mode, tax: TaxInputs, lastClosedMonth: number) {
  const db = await database();
  await db.query(`INSERT INTO forecast_preferences (year, mode, tax, last_closed_month) VALUES ($1, $2, $3, $4)
    ON CONFLICT (year, mode) DO UPDATE SET tax = EXCLUDED.tax, last_closed_month = EXCLUDED.last_closed_month`,
  [FORECAST_YEAR, mode, JSON.stringify(tax), lastClosedMonth]);
}

export async function saveMonthlyPlan(mode: Mode, month: number, plan: MonthAmounts | null) {
  const db = await database();
  // Keep updates to other months when two tabs save at the same time.
  await db.query(`INSERT INTO forecast_preferences (year, mode, plans) VALUES ($1, $2, $3)
    ON CONFLICT (year, mode) DO UPDATE SET plans = forecast_preferences.plans || EXCLUDED.plans`,
  [FORECAST_YEAR, mode, JSON.stringify({ [month]: plan })]);
}

type ConnectionDetails = { company_id: string | number; company_name: string; version: string };

export async function connectionDetails() {
  return (await (await database()).query<ConnectionDetails>(
    `SELECT company_id, company_name, version FROM freee_connections WHERE id`,
  ))[0];
}

export async function loadForecast(mode: Mode) {
  const stored = await preferences(mode);
  if (mode === "demo") {
    const plans = { ...demoPlans, ...stored?.plans };
    return {
      actuals: demoMonths,
      plans: Object.values(plans).filter((plan) => plan !== null),
      tax: stored?.last_closed_month == null ? demoTax : stored.tax,
      lastClosedMonth: stored?.last_closed_month ?? 9,
      maxClosedMonth: 9,
      consumptionMethodConfirmed: true,
      companyName: null,
      syncedAt: null,
    };
  }

  const db = await database();
  const [connection] = await db.query<{
    company_name: string;
    snapshot: (FreeeAccountingSnapshot & { closedThroughMonth: number }) | null;
    synced_at: Date | null;
  }>(`SELECT c.company_name, s.snapshot, s.synced_at
    FROM freee_connections c LEFT JOIN freee_snapshots s ON s.company_id = c.company_id AND s.year = $1
    WHERE c.id`, [FORECAST_YEAR]);
  const settings = connection?.snapshot?.taxSettings;
  const tax: TaxInputs = stored?.tax ?? {};
  const maxClosedMonth = Math.min(connection?.snapshot?.closedThroughMonth ?? 0, currentForecastDate().latestClosedMonth);
  const simplifiedRates = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
  return {
    actuals: connection?.snapshot?.months ?? [],
    plans: Object.values(stored?.plans ?? {}).filter((plan) => plan !== null),
    tax: {
      ...tax,
      consumptionMethod: tax.consumptionMethod ?? settings?.method ?? undefined,
      simplifiedPurchaseRate: tax.simplifiedPurchaseRate ?? (settings?.simpleBusinessCategory
        ? simplifiedRates[settings.simpleBusinessCategory - 1] : undefined),
    },
    lastClosedMonth: Math.min(stored?.last_closed_month ?? maxClosedMonth, maxClosedMonth),
    maxClosedMonth,
    companyName: connection?.company_name ?? null,
    syncedAt: connection?.synced_at == null ? null : new Date(connection.synced_at).toISOString(),
    consumptionMethodConfirmed: tax.consumptionMethod !== undefined,
  };
}

export async function saveOAuthAttempt(state: string, session: string) {
  const db = await database();
  await db.query(`DELETE FROM oauth_attempts WHERE expires_at <= now()`);
  await db.query(`INSERT INTO oauth_attempts (state_hash, session_id, expires_at)
    VALUES ($1, $2, now() + interval '10 minutes')`, [sha256(state), session]);
}

export async function consumeOAuthAttempt(state: string, session: string) {
  const rows = await (await database()).query(`DELETE FROM oauth_attempts
    WHERE state_hash = $1 AND session_id = $2 AND expires_at > now() RETURNING state_hash`, [sha256(state), session]);
  return rows.length === 1;
}

export async function saveConnection(companyId: number, name: string, tokens: FreeeTokens) {
  const db = await database();
  const rows = await db.query(`INSERT INTO freee_connections (id, company_id, company_name, version, encrypted_tokens)
    VALUES (true, $1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, company_name = EXCLUDED.company_name,
    version = EXCLUDED.version, encrypted_tokens = EXCLUDED.encrypted_tokens, sync_id = NULL, sync_until = NULL
    WHERE freee_connections.company_id = EXCLUDED.company_id RETURNING id`,
  [companyId, name, randomUUID(), encryptTokenValues(tokens)]);
  return rows.length === 1;
}

export async function beginSync(version: string) {
  const id = randomUUID();
  const rows = await (await database()).query(`UPDATE freee_connections
    SET sync_id = $1, sync_until = now() + interval '3 minutes'
    WHERE id AND version = $2 AND (sync_until IS NULL OR sync_until < now()) RETURNING id`, [id, version]);
  return rows.length ? id : null;
}

export async function finishSync(id: string, version: string, snapshot?: FreeeAccountingSnapshot & { closedThroughMonth: number }) {
  const db = await database();
  return db.transaction(async (query) => {
    const [row] = await query<{ company_id: string }>(`UPDATE freee_connections SET sync_id = NULL, sync_until = NULL
      WHERE id AND version = $1 AND sync_id = $2 RETURNING company_id`, [version, id]);
    if (!row || !snapshot) return false;
    await query(`INSERT INTO freee_snapshots (company_id, year, snapshot) VALUES ($1, $2, $3)
      ON CONFLICT (company_id, year) DO UPDATE SET snapshot = EXCLUDED.snapshot, synced_at = now()`,
    [row.company_id, FORECAST_YEAR, JSON.stringify(snapshot)]);
    return true;
  });
}

export async function activeTokens(version: string, refresh: (tokens: FreeeTokens) => Promise<FreeeTokens>) {
  return (await database()).transaction(async (query) => {
    const [row] = await query<{ encrypted_tokens: string; company_id: string }>(
      `SELECT encrypted_tokens, company_id FROM freee_connections WHERE id AND version = $1 FOR UPDATE`, [version],
    );
    if (!row) throw new Error("freee connection changed");
    const tokens = decryptTokenValues<FreeeTokens>(row.encrypted_tokens);
    if (tokens.expiresAt > Date.now() + 120_000) return tokens;
    const updated = await refresh(tokens);
    if (updated.companyId !== null && updated.companyId !== Number(row.company_id)) throw new Error("freee company changed");
    await query(`UPDATE freee_connections SET encrypted_tokens = $1 WHERE id`, [encryptTokenValues(updated)]);
    return updated;
  });
}
