import { recentClosedAmounts, type ForecastMonth } from "./forecast";
import type { AccountItemAmount, FreeeAccountingMonth } from "./freee";

const categories = ["sales", "expenses"] as const;
type Category = (typeof categories)[number];
type AccountItems = Record<Category, AccountItemAmount[] | null>;

export type MonthlyChartAccountItems = Record<number, AccountItems>;

function addItems(totals: Map<number, AccountItemAmount>, items: AccountItemAmount[]) {
  for (const item of items) {
    const previous = totals.get(item.id);
    totals.set(item.id, { ...item, amount: (previous?.amount ?? 0) + item.amount });
  }
}

export function getChartAccountItems(months: ForecastMonth[], actuals: FreeeAccountingMonth[]): MonthlyChartAccountItems {
  const byMonth = new Map(actuals.map((record) => [record.month, record]));
  const lastClosedMonth = months.filter(({ closed }) => closed).at(-1)?.month ?? 0;

  function actualItems(month: number, category: Category, amount: number | null) {
    const items = byMonth.get(month)?.accountItems?.[category];
    return amount !== null && items?.reduce((sum, item) => sum + item.amount, 0) === amount ? items : null;
  }

  function averageItems(category: Category) {
    const sample = recentClosedAmounts(byMonth, lastClosedMonth, category);
    if (sample.length === 0) return null;
    const totals = new Map<number, AccountItemAmount>();
    for (const { month, amount } of sample) {
      const items = actualItems(month, category, amount);
      if (!items) return null;
      addItems(totals, items);
    }

    const rounded = [...totals.values()].map((item) => {
      const amount = Math.floor(item.amount / sample.length);
      return { item, amount, remainder: item.amount - amount * sample.length };
    }).sort((a, b) => b.remainder - a.remainder || a.item.id - b.item.id);
    const average = Math.round(sample.reduce((sum, { amount }) => sum + amount, 0) / sample.length);
    // Allocate the remaining yen by fractional remainder so the account amounts sum to the forecast total.
    const remaining = average - rounded.reduce((sum, { amount }) => sum + amount, 0);
    return rounded.map(({ item, amount }, index) => ({ ...item, amount: amount + Number(index < remaining) }));
  }

  const averages = { sales: averageItems("sales"), expenses: averageItems("expenses") };
  function displayedItems(row: ForecastMonth, category: Category) {
    if (row.sources[category] === "average") return averages[category];
    if (row.sources[category] === "actual") return actualItems(row.month, category, row.actual[category]);
    return null;
  }

  return Object.fromEntries(months.map((row) => [row.month, {
    sales: displayedItems(row, "sales"),
    expenses: displayedItems(row, "expenses"),
  }]));
}

export function summarizeAccountItems(months: ForecastMonth[], accountItems: MonthlyChartAccountItems) {
  return categories.map((category) => {
    const totals = new Map<number, AccountItemAmount>();
    let manual: number | null = null;
    let unavailable: number | null = null;
    for (const row of months) {
      const amount = row.forecast[category];
      if (amount === null) return null;
      const items = accountItems[row.month][category];
      if (items) addItems(totals, items);
      else if (row.sources[category] === "plan") manual = (manual ?? 0) + amount;
      else unavailable = (unavailable ?? 0) + amount;
    }

    return {
      items: [...totals.values()].filter(({ amount }) => amount !== 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.id - b.id),
      manual,
      unavailable,
    };
  });
}
