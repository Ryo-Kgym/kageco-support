import assert from "node:assert/strict";
import test from "node:test";
import { FORECAST_YEAR } from "../src/lib/forecast";
import {
  activeTokens, beginSync, canUseAccessToken, closeForecastSession, finishSync,
  loadForecast, saveMonthlyPlan, saveMonthlyPlanMode, savePreferences,
} from "../src/lib/forecast-store";
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
