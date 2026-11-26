import assert from "node:assert/strict";
import test from "node:test";
import { loadForecast, saveMonthlyPlan, saveMonthlyPlanMode } from "../src/lib/forecast-store";

test("monthly forecast modes start at trend and retain manual amounts across switches", async () => {
  const initialReal = await loadForecast("real");
  const initialDemo = await loadForecast("demo");
  assert.equal(initialReal.monthlyPlanMode, "trend");
  assert.equal(initialDemo.monthlyPlanMode, "trend");
  assert.equal(initialDemo.plans.find((entry) => entry.month === 12)?.sales, 1_034_000);

  const plan = { month: 12, sales: 0 };
  await saveMonthlyPlanMode("real", "manual");
  await saveMonthlyPlan("real", 12, plan);
  assert.equal((await loadForecast("demo")).monthlyPlanMode, "trend");

  await saveMonthlyPlanMode("real", "trend");
  assert.equal((await loadForecast("real")).monthlyPlanMode, "trend");

  await saveMonthlyPlanMode("real", "manual");
  const restored = await loadForecast("real");
  assert.equal(restored.monthlyPlanMode, "manual");
  assert.deepEqual(restored.plans, [plan]);
});
