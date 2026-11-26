import assert from "node:assert/strict";
import test from "node:test";
import { getChartAccountItems, summarizeAccountItems } from "../src/lib/chart-account-items";
import { calculateForecast, FORECAST_YEAR } from "../src/lib/forecast";
import type { FreeeAccountingMonth } from "../src/lib/freee";

function actualMonth(
  month: number,
  sales: number | null,
  expenses: number | null,
  accountItems?: FreeeAccountingMonth["accountItems"],
): FreeeAccountingMonth {
  return { month, sales, expenses, salesTax: 0, deductiblePurchaseTax: 0, accountItems };
}

test("reconciles signed account averages to the three available closed totals", () => {
  const actuals = [
    actualMonth(1, 100, 50),
    actualMonth(2, 3, -5, {
      sales: [{ id: 1, name: "制作売上", amount: 1 }, { id: 2, name: "保守売上", amount: 2 }],
      expenses: [{ id: 3, name: "通信費", amount: -2 }, { id: 4, name: "外注費", amount: -3 }],
    }),
    actualMonth(3, null, null),
    actualMonth(4, 0, 0, { sales: [], expenses: [] }),
    actualMonth(5, 2, -2, {
      sales: [{ id: 1, name: "制作売上", amount: 1 }, { id: 2, name: "保守売上", amount: 1 }],
      expenses: [{ id: 3, name: "通信費", amount: 1 }, { id: 4, name: "外注費", amount: -3 }],
    }),
    actualMonth(6, 999, 999),
  ];
  const { months } = calculateForecast({
    year: FORECAST_YEAR, lastClosedMonth: 5, actuals, plans: [{ month: 6, sales: 6 }],
  });
  const items = getChartAccountItems(months, actuals);

  assert.deepEqual(items[3], { sales: null, expenses: null });
  assert.deepEqual(items[4], { sales: [], expenses: [] });
  assert.equal(items[6].sales, null);
  assert.deepEqual(items[6].expenses, items[7].expenses);
  assert.deepEqual(items[7].sales, [
    { id: 1, name: "制作売上", amount: 1 }, { id: 2, name: "保守売上", amount: 1 },
  ]);
  assert.deepEqual(items[7].expenses?.filter(({ amount }) => amount !== 0), [{ id: 4, name: "外注費", amount: -2 }]);
  for (const category of ["sales", "expenses"] as const) {
    assert.equal(items[7][category]?.reduce((sum, { amount }) => sum + amount, 0), months[6].forecast[category]);
  }
});

test("reports legacy and mismatched account items separately from manual totals", () => {
  const actuals = [
    actualMonth(1, 9, 3),
    actualMonth(2, 12, 3, {
      sales: [{ id: 1, name: "制作売上", amount: 12 }],
      expenses: [{ id: 2, name: "外注費", amount: 9 }],
    }),
  ];
  const { months } = calculateForecast({
    year: FORECAST_YEAR, lastClosedMonth: 2, actuals, plans: [{ month: 3, sales: 20, expenses: 5 }],
  });
  const items = getChartAccountItems(months, actuals);

  assert.deepEqual(items[1], { sales: null, expenses: null });
  assert.equal(items[2].expenses, null);
  assert.deepEqual(items[4], { sales: null, expenses: null });
  assert.deepEqual(summarizeAccountItems(months.slice(0, 3), items), [
    { items: [{ id: 1, name: "制作売上", amount: 12 }], manual: 20, unavailable: 9 },
    { items: [], manual: 5, unavailable: 6 },
  ]);
});
