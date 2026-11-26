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

test("reconciles signed account amounts to the average including a recorded zero and a missing month", () => {
  const actuals = [
    actualMonth(1, 100, 2, {
      sales: [{ id: 5, name: "初月売上", amount: 100 }],
      expenses: [{ id: 6, name: "雑費", amount: 2 }],
    }),
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
    { id: 2, name: "保守売上", amount: 1 }, { id: 1, name: "制作売上", amount: 0 }, { id: 5, name: "初月売上", amount: 25 },
  ]);
  assert.deepEqual(items[7].expenses, [
    { id: 3, name: "通信費", amount: 0 }, { id: 4, name: "外注費", amount: -1 }, { id: 6, name: "雑費", amount: 0 },
  ]);
  for (const category of ["sales", "expenses"] as const) {
    assert.equal(items[7][category]?.reduce((sum, { amount }) => sum + amount, 0), months[6].forecast[category]);
  }
});

test("includes every closed month from January and ignores partial actuals in the forecast account averages", () => {
  const sales = [1, 100, 130, 150, 900, 29, 750];
  const expenses = [90, 10, 30, 100, 40, 5, 800];
  const actuals = sales.map((amount, index) => actualMonth(index + 1, amount, expenses[index], {
    sales: [{ id: index + 1, name: `${index + 1}月の売上`, amount }],
    expenses: [{ id: index + 8, name: `${index + 1}月の経費`, amount: expenses[index] }],
  }));
  const { months } = calculateForecast({ year: FORECAST_YEAR, lastClosedMonth: 6, actuals });
  const items = getChartAccountItems(months, actuals);

  assert.deepEqual(items[7].sales?.map(({ id }) => id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(items[7].expenses?.map(({ id }) => id).sort((a, b) => a - b), [8, 9, 10, 11, 12, 13]);
  assert.equal(items[1].sales?.[0].amount, 1);
  assert.equal(items[5].sales?.[0].amount, 900);
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
  assert.deepEqual(summarizeAccountItems(months.slice(0, 3), items), {
    sales: { items: [{ id: 1, name: "制作売上", amount: 12 }], manual: 20, unavailable: 9, hasMissingMonths: false },
    expenses: { items: [], manual: 5, unavailable: 6, hasMissingMonths: false },
  });
});

test("uses each series' closing month for the chart's account item average", () => {
  const actuals = [
    actualMonth(1, 100, 60, { sales: [{ id: 1, name: "制作売上", amount: 100 }], expenses: [{ id: 2, name: "外注費", amount: 60 }] }),
    actualMonth(2, 0, 30, { sales: [], expenses: [{ id: 3, name: "通信費", amount: 30 }] }),
  ];
  const { months } = calculateForecast({ year: FORECAST_YEAR, lastClosedMonth: 2, lastClosedSalesMonth: 1, actuals });
  const items = getChartAccountItems(months, actuals);
  assert.deepEqual(items[2].sales, [{ id: 1, name: "制作売上", amount: 100 }]);
  assert.deepEqual(items[3].sales, items[2].sales);
  assert.deepEqual(items[2].expenses, [{ id: 3, name: "通信費", amount: 30 }]);
  assert.deepEqual(items[3].expenses, [{ id: 2, name: "外注費", amount: 30 }, { id: 3, name: "通信費", amount: 15 }]);
});

test("keeps known account items visible when another month's total is unknown", () => {
  const actuals = [
    actualMonth(1, 100, 30, {
      sales: [{ id: 1, name: "制作売上", amount: 100 }],
      expenses: [{ id: 2, name: "通信費", amount: 30 }],
    }),
    actualMonth(2, null, null),
  ];
  const { months } = calculateForecast({ year: FORECAST_YEAR, lastClosedMonth: 2, actuals });
  const items = getChartAccountItems(months, actuals);

  assert.deepEqual(summarizeAccountItems(months.slice(0, 2), items), {
    sales: { items: [{ id: 1, name: "制作売上", amount: 100 }], manual: null, unavailable: null, hasMissingMonths: true },
    expenses: { items: [{ id: 2, name: "通信費", amount: 30 }], manual: null, unavailable: null, hasMissingMonths: true },
  });
});
