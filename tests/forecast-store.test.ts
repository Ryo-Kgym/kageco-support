import assert from "node:assert/strict";
import test from "node:test";
import { loadForecast, saveMonthlyPlan, saveMonthlyPlanMode } from "../src/lib/forecast-store";

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
