import assert from "node:assert/strict";
import test from "node:test";
import {
  activeTokens, beginSync, connectionDetails, consumeOAuthAttempt, disconnectConnection, finishSync,
  loadForecast, saveConnection, saveMonthlyPlan, saveMonthlyPlanMode, saveOAuthAttempt,
} from "../src/lib/forecast-store";

test("can sync with an existing access token while it has time for the sync to complete", async () => {
  const companyId = 123;
  const companyName = "テスト事業所";
  const session = "token-test-session";
  await saveOAuthAttempt("token-test", session);
  const generation = await consumeOAuthAttempt("token-test", session);
  assert.ok(generation !== null);
  const expiresSoon = { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: Date.now() + 30_000, companyId };
  assert.equal(await saveConnection(companyId, companyName, expiresSoon, generation), "connected");
  const connection = await connectionDetails();
  assert.ok(connection);
  assert.equal((await loadForecast()).canSyncWithoutRefresh, false);

  const usable = { ...expiresSoon, expiresAt: Date.now() + 3_600_000 };
  assert.equal(await activeTokens(connection.version, async () => usable), usable);
  assert.equal((await loadForecast()).canSyncWithoutRefresh, true);
  assert.equal(await activeTokens(connection.version, async () => {
    assert.fail("a usable access token should not be refreshed");
  }), usable);

  await disconnectConnection();
  assert.equal((await loadForecast()).canSyncWithoutRefresh, false);
});

test("monthly forecast modes start at trend and retain manual amounts across switches", async () => {
  const initial = await loadForecast();
  assert.equal(initial.monthlyPlanMode, "trend");
  assert.deepEqual(initial.actuals, []);
  assert.deepEqual(initial.plans, []);

  const plan = { month: 12, sales: 0 };
  await saveMonthlyPlanMode("manual");
  await saveMonthlyPlan(12, plan);

  await saveMonthlyPlanMode("trend");
  assert.equal((await loadForecast()).monthlyPlanMode, "trend");

  await saveMonthlyPlanMode("manual");
  const restored = await loadForecast();
  assert.equal(restored.monthlyPlanMode, "manual");
  assert.deepEqual(restored.plans, [plan]);
});

test("disconnect keeps synced results and rejects stale sync and OAuth completions", async () => {
  const year = 2026;
  const companyId = 123;
  const companyName = "テスト事業所";
  const tokens = { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: 0, companyId };
  const session = "test-session";
  await saveOAuthAttempt("initial", session);
  const generation = await consumeOAuthAttempt("initial", session);
  assert.ok(generation !== null);
  assert.equal(await saveConnection(companyId, companyName, tokens, generation), "connected");
  const connection = await connectionDetails();
  assert.ok(connection);

  const snapshot = {
    companyId, companyName, year, closedThroughMonth: 1,
    months: [{ month: 1, sales: 100_000, expenses: 12_000, salesTax: 10_000, deductiblePurchaseTax: 1_200 }],
    taxSettings: { method: "general" as const, accounting: "net" as const, simpleBusinessCategory: null },
  };
  const sync = await beginSync(connection.version);
  assert.ok(sync);
  assert.equal(await finishSync(sync, connection.version, snapshot), true);
  const staleSync = await beginSync(connection.version);
  assert.ok(staleSync);
  await saveOAuthAttempt("stale", session);
  const staleOAuth = await consumeOAuthAttempt("stale", session);
  assert.ok(staleOAuth !== null);

  assert.deepEqual(await disconnectConnection(), tokens);
  assert.equal(await connectionDetails(), undefined);
  assert.equal(await finishSync(staleSync, connection.version, snapshot), false);
  assert.equal(await saveConnection(companyId, companyName, tokens, staleOAuth), "invalid-oauth");
  const retained = await loadForecast();
  assert.equal(retained.connected, false);
  assert.equal(retained.companyName, companyName);
  assert.ok(retained.syncedAt);
  assert.deepEqual(retained.actuals, snapshot.months);
});
