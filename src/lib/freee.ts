import "server-only";

export const FREEE_ISSUER = "https://accounts.secure.freee.co.jp";
const ACCOUNTING_ORIGIN = "https://api.freee.co.jp";

type Fetch = typeof fetch;

export type FreeeTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  companyId: number | null;
};

export type FreeeAccountingMonth = {
  month: number;
  sales: number | null;
  expenses: number | null;
  salesTax: number | null;
  deductiblePurchaseTax: number | null;
};

export type FreeeTaxSettings = {
  method: "exempt" | "general" | "simplified" | null;
  accounting: "gross" | "net" | null;
  simpleBusinessCategory: number | null;
};

export type FreeeAccountingSnapshot = {
  companyId: number;
  companyName: string;
  year: number;
  months: FreeeAccountingMonth[];
  taxSettings: FreeeTaxSettings;
};

export class FreeeApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status = 0, code?: string) {
    super(message);
    this.name = "FreeeApiError";
    this.status = status;
    this.code = code;
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  company_id?: string | number;
};

type FiscalYear = {
  start_date: string;
  end_date: string;
  tax_method: number;
  tax_account_method: number;
  sales_tax_business_code: number | null;
};

type AccountItem = {
  id: number;
  name: string;
  account_category: string;
  categories?: string[];
};

type JournalLine = {
  account_item_id: number;
  line_type: "detail" | "tax";
  amount: number;
  vat: number | null;
  tax_code: number | null;
};

type Journal = {
  id: number;
  txn_date: string;
  approval_status?: "none" | "in_progress" | "approved";
  debit: JournalLine[];
  credit: JournalLine[];
};

type JournalPage = { data: Journal[]; next_page_token: string | null };

const knownErrorCodes = new Set([
  "expired_access_token",
  "invalid_grant",
  "invalid_client",
  "re_authorization_required",
  "user_do_not_have_permission",
]);

async function requestJson<T>(url: string, init: RequestInit, fetcher: Fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FreeeApiError("freeeへの接続がタイムアウトしたか、通信に失敗しました。");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown; errors?: { code?: unknown }[] } | null;
    const rawCode = body?.error ?? body?.errors?.[0]?.code;
    const code = typeof rawCode === "string" && knownErrorCodes.has(rawCode) ? rawCode : undefined;
    if (code === "invalid_grant" || code === "re_authorization_required" || code === "expired_access_token") {
      throw new FreeeApiError("freeeの認可が失効しました。再連携してください。", response.status, code);
    }
    if (response.status === 401 || response.status === 403) {
      throw new FreeeApiError("freeeのアプリ設定と対象事業所の参照権限を確認してください。", response.status, code);
    }
    if (response.status === 429) {
      throw new FreeeApiError("freee APIの利用上限に達しました。時間をおいて同期してください。", response.status);
    }
    throw new FreeeApiError(`freee APIの処理に失敗しました（HTTP ${response.status}）。`, response.status, code);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new FreeeApiError("freee APIの応答を読み取れませんでした。");
  }
}

export function freeeAuthorizationUrl({ clientId, redirectUri, state }: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("/public_api/authorize", FREEE_ISSUER);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    prompt: "select_company",
  }).toString();
  return url.href;
}

async function requestTokens(params: Record<string, string>, fetcher: Fetch): Promise<FreeeTokens> {
  const result = await requestJson<TokenResponse>(`${FREEE_ISSUER}/public_api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  }, fetcher);
  if (typeof result?.access_token !== "string" || !result.access_token ||
      typeof result.refresh_token !== "string" || !result.refresh_token ||
      !Number.isSafeInteger(result.expires_in) || result.expires_in <= 0) {
    throw new FreeeApiError("freeeから有効なトークンを取得できませんでした。");
  }
  const companyId = Number(result.company_id);
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: Date.now() + result.expires_in * 1_000,
    companyId: Number.isSafeInteger(companyId) && companyId > 0 ? companyId : null,
  };
}

export function exchangeFreeeCode({ clientId, clientSecret, redirectUri, code, fetcher = fetch }: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  fetcher?: Fetch;
}): Promise<FreeeTokens> {
  return requestTokens({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  }, fetcher);
}

export function refreshFreeeTokens({ clientId, clientSecret, refreshToken, fetcher = fetch }: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetcher?: Fetch;
}): Promise<FreeeTokens> {
  return requestTokens({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  }, fetcher);
}

function accountingRequest<T>(path: string, accessToken: string, fetcher: Fetch, searchBody?: Record<string, unknown>): Promise<T> {
  return requestJson<T>(`${ACCOUNTING_ORIGIN}/api/1/${path}`, {
    method: searchBody ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(searchBody && { "Content-Type": "application/json" }),
    },
    body: searchBody ? JSON.stringify(searchBody) : undefined,
  }, fetcher);
}

export async function getFreeeCompany({ accessToken, companyId, fetcher = fetch }: {
  accessToken: string;
  companyId: number;
  fetcher?: Fetch;
}) {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    throw new FreeeApiError("freeeの連携先事業所を確認できませんでした。");
  }
  const result = await accountingRequest<{ company: {
    id: number;
    name: string | null;
    display_name: string | null;
    org_code: number | null;
    fiscal_years: FiscalYear[];
  } }>(`companies/${companyId}`, accessToken, fetcher);
  const company = result?.company;
  if (company?.id !== companyId || !Array.isArray(company.fiscal_years)) {
    throw new FreeeApiError("freeeの事業所情報を取得できませんでした。");
  }
  return {
    id: company.id,
    name: company.display_name || company.name || `事業所 ${company.id}`,
    organizationType: company.org_code === 2 ? "individual" : company.org_code === 1 ? "corporation" : null,
    fiscalYears: company.fiscal_years,
  } as const;
}

const incomeCategories = new Set(["収入金額", "売上高", "繰戻額等"]);
const expenseCategories = new Set(["経費", "売上原価", "製品売上原価", "材料費", "労務費", "製造経費", "繰入額等", "専従給与"]);
const separateIncomeCategories = new Set(["不動産収入", "不動産所得", "必要経費"]);
const balanceSheetCategories = new Set([
  "資産", "負債", "資本", "純資産", "振替", "諸口",
  "現金・預金", "売上債権", "有価証券", "棚卸資産", "他流動資産", "有形固定資産", "無形固定資産",
  "投資等", "繰延資産", "仕入債務", "他流動負債", "固定負債", "元入金", "事業主貸", "事業主借",
]);

function accountRole(account?: AccountItem): "sales" | "expenses" | "other" | "unknown" {
  if (!account) return "unknown";
  const groups = [account.account_category, ...(account.categories ?? [])];
  if (groups.some((group) => separateIncomeCategories.has(group))) return "unknown";
  if (groups.some((group) => incomeCategories.has(group))) return "sales";
  if (groups.some((group) => expenseCategories.has(group))) return "expenses";
  return groups.some((group) => balanceSheetCategories.has(group)) ? "other" : "unknown";
}

function updateTax(month: FreeeAccountingMonth, line: JournalLine, direction: number, name: string | undefined, method: number, role: ReturnType<typeof accountRole>) {
  if (name && /^(対象外|不課税|非課|非資|対外|輸出|[課非共]対輸本)/.test(name)) return;
  const vat = typeof line.vat === "number" && Number.isSafeInteger(line.vat) ? line.vat : null;

  if (name && /^課税売(上|返|倒|回)/.test(name)) {
    if (month.salesTax !== null) {
      month.salesTax = vat === null ? null : month.salesTax + vat * direction;
    }
    return;
  }

  if (name && /^[課非共]対仕(入|返)/.test(name)) {
    if (month.deductiblePurchaseTax === null) return;
    if (method === 2 && name.startsWith("非対")) return;
    const canDetermineDeduction = method === 4 || (method !== 3 && name.startsWith("課対"));
    month.deductiblePurchaseTax = canDetermineDeduction && vat !== null
      ? month.deductiblePurchaseTax - vat * direction
      : null;
    return;
  }

  if (name && /^[課非共]対輸税/.test(name)) {
    month.deductiblePurchaseTax = null;
    return;
  }

  // A missing category on a balance-sheet counterpart without tax does not imply taxable activity.
  if (role !== "other" || (line.vat !== null && line.vat !== 0) || name) {
    month.salesTax = null;
    month.deductiblePurchaseTax = null;
  }
}

function accumulateLine(
  month: FreeeAccountingMonth,
  line: JournalLine,
  direction: number,
  accounts: Map<number, AccountItem>,
  taxNames: Map<number, string>,
  taxMethod: number,
) {
  // The search API appends VAT lines for net accounting. VAT is already on each underlying detail line.
  if (line.line_type === "tax") return;
  if (line.line_type !== "detail" || !Number.isSafeInteger(line.amount)) {
    throw new FreeeApiError("freeeの仕訳明細の形式を確認できませんでした。");
  }
  if (line.amount === 0 && (line.vat === 0 || line.vat === null)) return;

  const account = accounts.get(line.account_item_id);
  const role = accountRole(account);
  if (role === "sales" && month.sales !== null) month.sales += line.amount * direction;
  if (role === "expenses" && month.expenses !== null) month.expenses -= line.amount * direction;
  if (role === "unknown") {
    month.sales = null;
    month.expenses = null;
  }

  const taxName = line.tax_code === null ? undefined : taxNames.get(line.tax_code);
  if (account && /^仮[受払]消費税/.test(account.name)) {
    // Manually posted VAT adjustments require confirmation outside the line-level estimate.
    if (account.name.startsWith("仮受")) month.salesTax = null;
    else month.deductiblePurchaseTax = null;
    return;
  }
  updateTax(month, line, direction, taxName, taxMethod, role);
}

function dateAt(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getTaxSettings(year: FiscalYear): FreeeTaxSettings {
  const method = year.tax_method;
  const category = year.sales_tax_business_code;
  const accounting = year.tax_account_method;
  return {
    method: method === 0 ? "exempt" : method === 1 ? "simplified" : [2, 3, 4].includes(method) ? "general" : null,
    accounting: accounting === 0 ? "gross" : [1, 2].includes(accounting) ? "net" : null,
    simpleBusinessCategory: typeof category === "number" && Number.isInteger(category) && category >= 0 && category <= 5 ? category + 1 : null,
  };
}

export async function syncFreeeAccounting({ accessToken, companyId, year, throughMonth, throughDate, fetcher = fetch }: {
  accessToken: string;
  companyId: number;
  year: number;
  throughMonth: number;
  throughDate?: string;
  fetcher?: Fetch;
}): Promise<FreeeAccountingSnapshot> {
  if (!Number.isInteger(year) || year < 2000 || year > 9999 ||
      !Number.isInteger(throughMonth) || throughMonth < 1 || throughMonth > 12) {
    throw new FreeeApiError("同期する年と月を確認してください。");
  }
  const finalMonthStart = dateAt(year, throughMonth, 1);
  const finalMonthEnd = dateAt(year, throughMonth, daysInMonth(year, throughMonth));
  if (throughDate && (!/^\d{4}-\d{2}-\d{2}$/.test(throughDate) || throughDate < finalMonthStart || throughDate > finalMonthEnd)) {
    throw new FreeeApiError("同期の終了日を確認してください。");
  }

  const company = await getFreeeCompany({ accessToken, companyId, fetcher });
  if (company.organizationType !== "individual") {
    throw new FreeeApiError("freeeで個人事業主の事業所を選択してください。");
  }
  const fiscalYear = company.fiscalYears.find((period) =>
    period.start_date.startsWith(`${year}-`) && period.end_date === dateAt(year, 12, 31));
  if (!fiscalYear) throw new FreeeApiError("freeeで対象年分の会計期間を確認してください。");

  const [accountResult, taxResult] = await Promise.all([
    accountingRequest<{ account_items: AccountItem[] }>(`account_items?company_id=${companyId}`, accessToken, fetcher),
    accountingRequest<{ taxes: { code: number; name_ja: string }[] }>(`taxes/companies/${companyId}`, accessToken, fetcher),
  ]);
  if (!Array.isArray(accountResult?.account_items) || !Array.isArray(taxResult?.taxes)) {
    throw new FreeeApiError("freeeの勘定科目または税区分を取得できませんでした。");
  }
  const accounts = new Map(accountResult.account_items.map((account) => [account.id, account]));
  const taxNames = new Map(taxResult.taxes.map((tax) => [tax.code, tax.name_ja]));
  const months: FreeeAccountingMonth[] = [];
  for (let month = 1; month <= throughMonth; month += 1) {
    const start = dateAt(year, month, 1);
    const end = month === throughMonth ? throughDate ?? finalMonthEnd : dateAt(year, month, daysInMonth(year, month));
    const totals: FreeeAccountingMonth = { month, sales: 0, expenses: 0, salesTax: 0, deductiblePurchaseTax: 0 };
    const journalsSeen = new Set<number>();
    const pageTokens = new Set<string>();
    let pageToken: string | null = null;

    do {
      const page: JournalPage = await accountingRequest<JournalPage>("journals/search", accessToken, fetcher, {
        company_id: companyId,
        start_issue_date: start,
        end_issue_date: end,
        page_size: 1_000,
        ...(pageToken && { page_token: pageToken }),
      });
      if (!Array.isArray(page?.data) ||
          (page.next_page_token !== null && (typeof page.next_page_token !== "string" || !page.next_page_token))) {
        throw new FreeeApiError("freeeの仕訳一覧を取得できませんでした。");
      }
      for (const journal of page.data) {
        if (!Number.isSafeInteger(journal.id) || !Array.isArray(journal.debit) || !Array.isArray(journal.credit) ||
            typeof journal.txn_date !== "string" || journal.txn_date < start || journal.txn_date > end) {
          throw new FreeeApiError("freeeの仕訳の形式または日付を確認できませんでした。");
        }
        if (journalsSeen.has(journal.id)) continue;
        journalsSeen.add(journal.id);
        if (journal.approval_status === "in_progress") continue;
        for (const line of journal.debit) accumulateLine(totals, line, -1, accounts, taxNames, fiscalYear.tax_method);
        for (const line of journal.credit) accumulateLine(totals, line, 1, accounts, taxNames, fiscalYear.tax_method);
      }
      pageToken = page.next_page_token;
      if (pageToken !== null) {
        if (pageTokens.has(pageToken)) throw new FreeeApiError("freeeの仕訳一覧を最後まで取得できませんでした。");
        pageTokens.add(pageToken);
      }
    } while (pageToken !== null);

    months.push(totals);
  }

  return { companyId, companyName: company.name, year, months, taxSettings: getTaxSettings(fiscalYear) };
}
