"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AccountItemColors, MonthlyChartAccountItems } from "@/lib/chart-account-items";
import type { ForecastMonth } from "@/lib/forecast";

const seriesLabels = { sales: "売上", expenses: "経費" } as const;
const seriesKeys = ["sales", "expenses"] as const;
type SeriesKey = typeof seriesKeys[number];
type AccountItem = NonNullable<MonthlyChartAccountItems[number][SeriesKey]>[number];
type ChartSeries = {
  key: SeriesKey;
  amount: number | null;
  source: ForecastMonth["sources"][SeriesKey];
  items: AccountItem[] | null;
};

type ActiveMonth = {
  month: number;
  interaction: "hover" | "focus" | "press";
  x: number;
  placeAbove: boolean;
  maxHeight: number;
};

const amountFormat = new Intl.NumberFormat("ja-JP");
const amountLabel = (amount: number | null) => amount === null ? "未算出" : `${amountFormat.format(amount)}円`;

function makeSeries(row: ForecastMonth, accountItems: MonthlyChartAccountItems) {
  return seriesKeys.map((key): ChartSeries => ({
    key,
    amount: row.forecast[key],
    source: row.sources[key],
    items: accountItems[row.month]?.[key]?.filter(({ amount }) => amount !== 0) ?? null,
  }));
}

function seriesNote(series: ChartSeries) {
  if (series.amount === null) return null;
  if (series.source === "plan") return "手入力（内訳なし）";
  if (series.items === null) return "内訳未取得";
  if (series.items.length === 0) return "該当する勘定科目なし";
  return null;
}

function seriesSource(source: ChartSeries["source"]) {
  if (source === "actual") return "実績";
  if (source === "average") return "推移見込み";
  if (source === "plan") return "手入力の見込み";
  return null;
}

function swatch(color: string | undefined) {
  return { "--bar-color": color } as CSSProperties;
}

function ItemList({ items, itemColors }: { items: AccountItem[]; itemColors: AccountItemColors }) {
  return (
    <dl className="chart-item-list">
      {items.map((item) => (
        <div key={item.id}>
          <dt><span className="legend-swatch" style={swatch(itemColors.get(item.id)?.color)} aria-hidden="true" />{item.name}</dt>
          <dd>{amountLabel(item.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

function stackSegments(series: ChartSeries) {
  if (series.items !== null) return series.items;
  return series.amount ? [{ id: null, amount: series.amount }] : [];
}

function ChartBar({ series, zero, range, itemColors }: {
  series: ChartSeries;
  zero: number;
  range: number;
  itemColors: AccountItemColors;
}) {
  const amounts = stackSegments(series);
  let positive = 0;
  let negative = 0;
  return (
    <span className={`chart-bar-track${series.key === "expenses" ? " bar-expenses" : ""}`} aria-hidden="true">
      {amounts.map(({ id, amount }) => {
        const offset = amount < 0 ? (negative += amount) : positive;
        if (amount > 0) positive += amount;
        const style = {
          ...swatch(id === null ? undefined : itemColors.get(id)?.color),
          "--bar-height": `${Math.abs(amount) / range * 100}%`,
          "--bar-bottom": `${(zero + offset / range) * 100}%`,
        } as CSSProperties;
        return <span key={id ?? series.key} className={`chart-bar${series.source === "actual" ? "" : " is-forecast"}`} style={style} />;
      })}
    </span>
  );
}

export function MonthlyChart({ rows, accountItems, itemColors }: {
  rows: ForecastMonth[];
  accountItems: MonthlyChartAccountItems;
  itemColors: AccountItemColors;
}) {
  const [active, setActive] = useState<ActiveMonth | null>(null);
  const chartFrame = useRef<HTMLDivElement>(null);
  const activeButton = useRef<HTMLButtonElement>(null);
  const tooltipVisible = active !== null;
  useEffect(() => {
    if (!tooltipVisible) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActive(null);
    }
    function handleOutsidePress(event: PointerEvent) {
      if (event.target instanceof Node && !chartFrame.current?.contains(event.target)) setActive(null);
    }
    document.addEventListener("keydown", handleEscape);
    document.addEventListener("pointerdown", handleOutsidePress);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("pointerdown", handleOutsidePress);
    };
  }, [tooltipVisible]);

  const chartRows = rows.map((row) => ({ ...row, series: makeSeries(row, accountItems) }));
  const available = chartRows.some(({ series }) => series.some(({ amount }) => amount !== null));
  let ceiling = 0;
  let floor = 0;
  for (const { series } of chartRows) {
    for (const group of series) {
      const amounts = stackSegments(group);
      ceiling = Math.max(ceiling, amounts.reduce((sum, { amount }) => sum + Math.max(0, amount), 0));
      floor = Math.min(floor, amounts.reduce((sum, { amount }) => sum + Math.min(0, amount), 0));
    }
  }

  const range = ceiling - floor || 1;
  const zero = -floor / range;
  const chartStyle = { "--chart-zero": `${zero * 100}%` } as CSSProperties;
  const activeRow = chartRows.find(({ month }) => month === active?.month);

  function reveal(button: HTMLButtonElement, month: number, interaction: ActiveMonth["interaction"]) {
    const frame = chartFrame.current;
    if (!frame) return;
    const chartBounds = frame.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    const spaceAbove = chartBounds.top;
    const spaceBelow = window.innerHeight - chartBounds.bottom;
    const placeAbove = spaceAbove > Math.min(spaceBelow, 300);
    const height = placeAbove ? spaceAbove : spaceBelow;
    activeButton.current = button;
    setActive({
      month,
      interaction,
      x: buttonBounds.left + buttonBounds.width / 2 - chartBounds.left,
      placeAbove,
      maxHeight: Math.max(128, Math.min(height, 340)),
    });
  }

  return (
    <section className="dashboard-panel" id="monthly" aria-labelledby="monthly-heading">
      <header className="panel-heading">
        <h2 id="monthly-heading">月ごとの事業収支</h2>
        <p>締め済みの実績と各月の着地見込み</p>
      </header>
      {available ? (
        <>
          <div className="chart-key">
            <ul className="chart-legend" aria-label="グラフの凡例">
              <li>売上（左）</li>
              <li>経費（右）</li>
              <li><span className="legend-swatch" aria-hidden="true" />実績</li>
              <li><span className="legend-swatch is-forecast" aria-hidden="true" />見込み</li>
            </ul>
            {itemColors.size > 0 && (
              <details className="chart-color-key">
                <summary>勘定科目の色</summary>
                <ul className="chart-legend">
                  {[...itemColors].map(([id, { name, color }]) => (
                    <li key={id}><span className="legend-swatch" style={swatch(color)} aria-hidden="true" />{name}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <p className="chart-hint">月にカーソルを合わせるか選択すると、内訳を確認できます。<span className="chart-scroll-hint">横にスクロールできます。</span></p>
          <div
            className="chart-frame"
            ref={chartFrame}
            onPointerLeave={() => setActive((current) => current?.interaction === "hover" ? null : current)}
          >
            <div className="chart-scroll" onScroll={() => {
              if (active && activeButton.current) reveal(activeButton.current, active.month, active.interaction);
            }}>
              <div className="monthly-chart" style={chartStyle}>
                {chartRows.map(({ month, closed, series }) => (
                  <button
                    className={`chart-month${active?.month === month ? " is-active" : ""}`}
                    key={month}
                    type="button"
                    aria-label={`${month}月 ${series.map(({ key, amount }) => `${seriesLabels[key]} ${amountLabel(amount)}`).join("、")}`}
                    aria-describedby={active?.month === month ? "monthly-chart-tooltip" : undefined}
                    onPointerEnter={(event) => { if (event.pointerType !== "touch") reveal(event.currentTarget, month, "hover"); }}
                    onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) reveal(event.currentTarget, month, "focus"); }}
                    onBlur={() => setActive((current) => current?.month === month && current.interaction !== "hover" ? null : current)}
                    onClick={(event) => {
                      if (active?.month === month && active.interaction === "press") setActive(null);
                      else reveal(event.currentTarget, month, "press");
                    }}
                  >
                    <span className="chart-month-bars">
                      <span className="chart-baseline" aria-hidden="true" />
                      {series.map((group) => <ChartBar key={group.key} series={group} zero={zero} range={range} itemColors={itemColors} />)}
                    </span>
                    <span className={`chart-month-label${closed ? "" : " is-projected"}`} aria-hidden="true">{month}月</span>
                  </button>
                ))}
              </div>
            </div>
            {active && activeRow && (
              <div
                className={`chart-tooltip${active.placeAbove ? " is-above" : ""}`}
                id="monthly-chart-tooltip"
                role="tooltip"
                style={{ "--tooltip-x": `${active.x}px`, "--tooltip-height": `${active.maxHeight}px` } as CSSProperties}
              >
                <h3>{active.month}月の勘定科目別内訳</h3>
                {activeRow.series.map((group) => {
                  const note = seriesNote(group);
                  const source = seriesSource(group.source);
                  return (
                    <div className="chart-tooltip-series" key={group.key}>
                      <div className="chart-tooltip-total">
                        <h4>{seriesLabels[group.key]}{source && <small>{source}</small>}</h4>
                        <strong>{amountLabel(group.amount)}</strong>
                      </div>
                      {group.items?.length ? <ItemList items={group.items} itemColors={itemColors} /> : note && <p>{note}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <p className="chart-empty">表示する月次データがありません。</p>
      )}
      <details className="monthly-detail">
        <summary>月別の金額と勘定科目を表示</summary>
        <div className="table-scroll">
          <table className="month-table" aria-label="事業売上と経費の月別実績・見込み">
            <thead>
              <tr>
                <th scope="col">月</th>
                <th scope="col" className="numeric-cell">売上実績</th>
                <th scope="col" className="numeric-cell">経費実績</th>
                <th scope="col" className="numeric-cell">売上見込み</th>
                <th scope="col" className="numeric-cell">経費見込み</th>
              </tr>
            </thead>
            <tbody>
              {chartRows.map(({ month, closedByAmount, actual, series }) => (
                <tr key={month}>
                  <th scope="row">{month}月</th>
                  {series.map((group) => (
                    <td key={`actual-${group.key}`} className="numeric-cell">
                      {amountLabel(actual[group.key])}
                      {closedByAmount[group.key] && <TableBreakdown group={group} month={month} itemColors={itemColors} />}
                    </td>
                  ))}
                  {series.map((group) => (
                    <td key={`forecast-${group.key}`} className="numeric-cell">
                      {closedByAmount[group.key] ? "締め済み" : amountLabel(group.amount)}
                      {!closedByAmount[group.key] && <TableBreakdown group={group} month={month} itemColors={itemColors} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function TableBreakdown({ group, month, itemColors }: { group: ChartSeries; month: number; itemColors: AccountItemColors }) {
  if (group.amount === null) return null;
  if (!group.items?.length) return <small className="chart-table-note">{seriesNote(group)}</small>;
  return (
    <details className="chart-table-breakdown">
      <summary aria-label={`${month}月の${seriesLabels[group.key]}${seriesSource(group.source) ?? ""}の勘定科目を表示`}>内訳</summary>
      <ItemList items={group.items} itemColors={itemColors} />
    </details>
  );
}
