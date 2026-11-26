import assert from "node:assert/strict";
import test from "node:test";
import { FORECAST_YEAR } from "../src/lib/forecast";
import {
  activeTokens, beginSync, canUseAccessToken, closeForecastSession, currentForecastDate, finishSync,
  loadForecast, saveClosedMonthOverrides, saveMonthlyPlan, saveMonthlyPlanMode, savePreferences, saveSharedClosedMonth,
} from "../src/lib/forecast-store";
import { forecastYears, isForecastYear, selectedForecastYear } from "../src/lib/forecast-year";
import type { FreeeTokens } from "../src/lib/freee";
import type { FreeeSession } from "../src/lib/security";

function testSession(id: string, companyId = 123): FreeeSession {
  return { id, companyId, companyName: "テスト事業所", expiresAt: Date.now() + 8 * 60 * 60_000 };
}

function testTokens(session: FreeeSession, expiresInMs: number): FreeeTokens {
  return { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: Date.now() + expiresInMs, companyId: session.companyId };
}

function testSnapshot(session: FreeeSession) {
  return {
    companyId: session.companyId, companyName: session.companyName, year: FORECAST_YEAR, closedThroughMonth: 1,
    months: [{ month: 1, sales: 100_000, expenses: 12_000, salesTax: 10_000, deductiblePurchaseTax: 1_200 }],
    taxSettings: { method: "general" as const, accounting: "net" as const, simpleBusinessCategory: null },
  };
}

test("uses a usable cookie token and coalesces refreshes within a login session", async () => {
  const session = testSession("token-test-session");
  const nearExpiry = testTokens(session, 30_000);
  const usable = testTokens(session, 3_600_000);
  assert.equal(canUseAccessToken(nearExpiry), false);
  assert.equal(canUseAccessToken(usable), true);
  assert.equal((await loadForecast(session)).canSyncWithoutRefresh, false);

  let refreshCount = 0;
  async function refresh(current: FreeeTokens) {
    refreshCount++;
    assert.equal(current, nearExpiry);
    return usable;
  }
  assert.deepEqual(await Promise.all([
    activeTokens(session, nearExpiry, refresh),
    activeTokens(session, nearExpiry, refresh),
  ]), [usable, usable]);
  assert.equal(refreshCount, 1);
  assert.equal((await loadForecast(session)).canSyncWithoutRefresh, true);
  assert.equal(await activeTokens(session, nearExpiry, async () => {
    assert.fail("the newer access token should not be refreshed");
  }), usable);

  const newInstanceSession = testSession("cookie-only-session");
  assert.equal(await activeTokens(newInstanceSession, usable, async () => {
    assert.fail("a usable cookie access token should not be refreshed");
  }), usable);
  assert.equal(await closeForecastSession(session), usable);
  assert.equal((await loadForecast(session)).canSyncWithoutRefresh, false);
});

test("monthly forecast modes start at trend and retain manual amounts across switches", async () => {
  const session = testSession("plan-test-session");
  const initial = await loadForecast(session);
  assert.equal(initial.monthlyPlanMode, "trend");
  assert.deepEqual(initial.actuals, []);
  assert.deepEqual(initial.plans, []);

  const plan = { month: 12, sales: 0 };
  await saveMonthlyPlanMode(session, "manual");
  await saveMonthlyPlan(session, 12, plan);

  await saveMonthlyPlanMode(session, "trend");
  assert.equal((await loadForecast(session)).monthlyPlanMode, "trend");

  await saveMonthlyPlanMode(session, "manual");
  const restored = await loadForecast(session);
  assert.equal(restored.monthlyPlanMode, "manual");
  assert.deepEqual(restored.plans, [plan]);
});

test("uses independent closed months and falls back to the shared setting for each side", async () => {
  const session = testSession("cutoff-test-session");
  const sync = await beginSync(session);
  assert.ok(sync);
  assert.equal(await finishSync(session, sync, { ...testSnapshot(session), closedThroughMonth: 3 }), true);

  await savePreferences(session, { salaryGross: 100_000 }, 1);
  const shared = await loadForecast(session);
  const sharedMonth = Math.min(1, shared.maxClosedMonth);
  assert.equal(shared.lastClosedSalesMonth, sharedMonth);
  assert.equal(shared.lastClosedExpenseMonth, sharedMonth);

  await saveClosedMonthOverrides(session, 0, 3);
  const independent = await loadForecast(session);
  assert.equal(independent.lastClosedMonth, 0);
  assert.equal(independent.lastClosedSalesMonth, 0);
  assert.equal(independent.lastClosedExpenseMonth, shared.maxClosedMonth);
  assert.equal(independent.lastClosedMonthSetting, 1);
  assert.equal(independent.lastClosedSalesMonthSetting, 0);
  assert.equal(independent.lastClosedExpenseMonthSetting, 3);
  assert.equal(independent.tax.salaryGross, 100_000);
  assert.equal(independent.tax.consumptionMethod, "general");
  assert.equal(independent.consumptionMethodConfirmed, false);

  await saveClosedMonthOverrides(session, null, 3);
  await savePreferences(session, { salaryGross: 200_000 });
  const restored = await loadForecast(session);
  assert.equal(restored.lastClosedMonth, sharedMonth);
  assert.equal(restored.lastClosedSalesMonth, sharedMonth);
  assert.equal(restored.lastClosedExpenseMonth, shared.maxClosedMonth);
  assert.equal(restored.lastClosedSalesMonthSetting, null);
  assert.equal(restored.lastClosedExpenseMonthSetting, 3);
});

test("uses the previous month in Japan and keeps incomplete data out of selected closed months", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date(`${FORECAST_YEAR}-01-01T00:00:00+09:00`) });
  const session = testSession("suggested-cutoff");
  assert.equal((await loadForecast(session)).defaultClosedMonth, 0);

  context.mock.timers.setTime(Date.parse(`${FORECAST_YEAR}-03-01T00:00:00+09:00`));
  const laterSession = testSession("partial-sync-cutoff");
  const beforeSync = await loadForecast(laterSession);
  assert.equal(beforeSync.defaultClosedMonth, 2);
  assert.equal(beforeSync.lastClosedMonth, 2);
  assert.equal(beforeSync.maxClosedMonth, 0);

  const snapshot = testSnapshot(laterSession);
  const partialMonth = { month: 2, sales: 10, expenses: 20, salesTax: 1, deductiblePurchaseTax: 2, taxableSalesByRate: { 10: 10 } };
  const sync = await beginSync(laterSession);
  assert.ok(sync);
  assert.equal(await finishSync(laterSession, sync, { ...snapshot, months: [...snapshot.months, partialMonth] }), true);
  const forecast = await loadForecast(laterSession);
  assert.equal(forecast.maxClosedMonth, 1);
  assert.equal(forecast.lastClosedMonth, 2);
  assert.deepEqual(forecast.actuals[1], {
    month: 2, sales: null, expenses: null, salesTax: null, deductiblePurchaseTax: null, taxableSalesByRate: null,
  });

  const plan = { month: 12, sales: 1_234 };
  await saveMonthlyPlan(laterSession, 12, plan);
  await savePreferences(laterSession, { salaryGross: 200_000 }, null, { lastClosedSalesMonth: 0 });
  await saveSharedClosedMonth(laterSession, 1);
  let updated = await loadForecast(laterSession);
  assert.equal(updated.lastClosedSalesMonth, 1);
  assert.equal(updated.lastClosedExpenseMonth, 1);
  assert.equal(updated.lastClosedSalesMonthSetting, null);
  assert.equal(updated.lastClosedExpenseMonthSetting, null);
  assert.deepEqual(updated.actuals[1], partialMonth);
  assert.deepEqual(updated.plans, [plan]);
  assert.equal(updated.monthlyPlanMode, "manual");
  assert.equal(updated.tax.salaryGross, 200_000);

  await savePreferences(laterSession, { salaryGross: 300_000 });
  updated = await loadForecast(laterSession);
  assert.equal(updated.lastClosedMonthSetting, 1);
  assert.equal(updated.tax.salaryGross, 300_000);

  await saveSharedClosedMonth(laterSession, 0);
  assert.equal((await loadForecast(laterSession)).lastClosedMonth, 0);
  await saveSharedClosedMonth(laterSession, null);
  assert.equal((await loadForecast(laterSession)).lastClosedMonth, 2);
});

test("keeps forecasts isolated across logins even for the same company", async () => {
  const owner = testSession("owner");
  const sameCompany = testSession("separate-login");
  const otherCompany = testSession("other-company", 456);
  const snapshot = testSnapshot(owner);
  const plan = { month: 12, sales: 1_234 };
  await savePreferences(owner, { salaryGross: 200_000 }, 1);
  await saveMonthlyPlan(owner, 12, plan);
  const sync = await beginSync(owner);
  assert.ok(sync);
  assert.equal(await finishSync(sameCompany, sync, snapshot), false);
  assert.equal(await finishSync(owner, sync, snapshot), true);

  const ownerForecast = await loadForecast(owner);
  assert.ok(ownerForecast.syncedAt);
  assert.deepEqual(ownerForecast.actuals, snapshot.months);
  assert.deepEqual(ownerForecast.plans, [plan]);
  assert.equal(ownerForecast.tax.salaryGross, 200_000);
  for (const separate of [sameCompany, otherCompany]) {
    const forecast = await loadForecast(separate);
    assert.equal(forecast.syncedAt, null);
    assert.deepEqual(forecast.actuals, []);
    assert.deepEqual(forecast.plans, []);
    assert.equal(forecast.tax.salaryGross, undefined);
  }

  const otherSync = await beginSync(otherCompany);
  assert.ok(otherSync);
  assert.equal(await finishSync(otherCompany, otherSync, snapshot), false);
  await assert.rejects(activeTokens(otherCompany, testTokens(owner, 3_600_000), async () => {
    assert.fail("different company tokens must not be accepted");
  }));
});

test("offers only the current Tokyo calendar year and the previous two years", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-12-31T14:59:59Z") });
  assert.deepEqual(forecastYears(), [2026, 2025, 2024]);
  assert.equal(selectedForecastYear(undefined), 2026);
  assert.equal(selectedForecastYear("2024"), 2024);
  assert.equal(selectedForecastYear("2027"), 2026);
  assert.equal(selectedForecastYear("2023"), 2026);
  assert.equal(selectedForecastYear(["2024", "2025"]), 2026);
  assert.equal(isForecastYear(2027), false);

  context.mock.timers.setTime(Date.parse("2026-12-31T15:00:00Z"));
  assert.deepEqual(forecastYears(), [2027, 2026, 2025]);
  assert.equal(selectedForecastYear(undefined), 2027);
  assert.equal(isForecastYear(2027), true);
});

test("keeps preferences, actuals, and pending syncs separate by forecast year", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2027-03-01T00:00:00+09:00") });
  const session = testSession("annual-forecast");
  const snapshot = testSnapshot(session);
  const nextSnapshot = { ...snapshot, year: 2027, months: [{ ...snapshot.months[0], sales: 200_000 }] };

  const originalSync = await beginSync(session);
  const nextSync = await beginSync(session, 2027);
  assert.ok(originalSync && nextSync);
  assert.equal(await beginSync(session, 2027), null);
  assert.equal(await finishSync(session, originalSync, nextSnapshot, 2027), false);
  assert.equal(await finishSync(session, originalSync, snapshot), true);
  assert.equal(await finishSync(session, nextSync, nextSnapshot, 2027), true);

  await savePreferences(session, { salaryGross: 100_000 }, 1);
  await savePreferences(session, { salaryGross: 200_000 }, undefined, undefined, 2027);
  await saveSharedClosedMonth(session, 0, 2027);
  await saveClosedMonthOverrides(session, 1, null, 2027);
  await saveMonthlyPlan(session, 12, { month: 12, sales: 50_000 }, 2027);

  const original = await loadForecast(session);
  const next = await loadForecast(session, 2027);
  const untouched = await loadForecast(session, 2025);
  assert.deepEqual(currentForecastDate(), { latestClosedMonth: 12, throughMonth: 12, throughDate: "2026-12-31" });
  assert.deepEqual(original.actuals, snapshot.months);
  assert.equal(original.tax.salaryGross, 100_000);
  assert.equal(original.lastClosedSalesMonthSetting, null);
  assert.deepEqual(original.plans, []);
  assert.deepEqual(next.actuals, nextSnapshot.months);
  assert.equal(next.defaultClosedMonth, 2);
  assert.equal(next.tax.salaryGross, 200_000);
  assert.equal(next.lastClosedSalesMonth, 1);
  assert.equal(next.lastClosedExpenseMonth, 0);
  assert.deepEqual(next.plans, [{ month: 12, sales: 50_000 }]);
  assert.equal(next.monthlyPlanMode, "manual");
  assert.equal(untouched.defaultClosedMonth, 12);
  assert.equal(untouched.syncedAt, null);
  assert.deepEqual(untouched.actuals, []);

  const staleSync = await beginSync(session, 2027);
  assert.ok(staleSync);
  await closeForecastSession(session);
  assert.equal(await finishSync(session, staleSync, nextSnapshot, 2027), false);
  assert.deepEqual((await loadForecast(session, 2027)).plans, []);
});

test("closing a login immediately discards data and rejects writes from its in-flight sync", async () => {
  const session = testSession("closing-owner");
  const snapshot = testSnapshot(session);
  const originalSync = await beginSync(session);
  assert.ok(originalSync);
  assert.equal(await finishSync(session, originalSync, snapshot), true);

  const staleSync = await beginSync(session);
  assert.ok(staleSync);
  const refresh = Promise.withResolvers<FreeeTokens>();
  const tokenRequest = activeTokens(session, testTokens(session, 0), () => refresh.promise);
  const closed = closeForecastSession(session);
  assert.equal(await finishSync(session, staleSync, snapshot), false);
  assert.equal(await beginSync(session), null);
  await saveMonthlyPlan(session, 12, { month: 12, sales: 100 });
  assert.deepEqual((await loadForecast(session)).actuals, []);
  assert.deepEqual((await loadForecast(session)).plans, []);

  const rotated = testTokens(session, 3_600_000);
  refresh.resolve(rotated);
  assert.equal(await tokenRequest, null);
  assert.equal(await closed, rotated);

  const newLogin = await loadForecast(testSession("closing-owner-new-login"));
  assert.deepEqual(newLogin.actuals, []);
  assert.deepEqual(newLogin.plans, []);
});
