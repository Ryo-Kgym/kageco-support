export function currentTokyoDate() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function forecastYears() {
  const year = Number(currentTokyoDate().slice(0, 4));
  return [year, year - 1, year - 2] as const;
}

export function isForecastYear(value: unknown): value is number {
  return forecastYears().some((year) => year === value);
}

export function selectedForecastYear(value: string | string[] | undefined, years = forecastYears()) {
  return years.find((year) => String(year) === value) ?? years[0];
}

export function forecastLocation(year: number, notice?: string, section?: string) {
  const search = new URLSearchParams({ year: String(year) });
  if (notice) search.set("notice", notice);
  return `/?${search}${section ? `#${section}` : ""}`;
}
