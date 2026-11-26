import assert from "node:assert/strict";
import test from "node:test";
import { exchangeFreeeCode, FreeeApiError, freeeAuthorizationUrl, refreshFreeeTokens, syncFreeeAccounting } from "../src/lib/freee";

test("exchanges and rotates freee tokens with the selected company", async () => {
  const redirectUri = "http://localhost:3000/freee/callback";
  const authorization = new URL(freeeAuthorizationUrl({ clientId: "example", redirectUri, state: "random-state" }));
  assert.equal(authorization.origin, "https://accounts.secure.freee.co.jp");
  assert.equal(authorization.pathname, "/public_api/authorize");
  assert.equal(authorization.searchParams.get("prompt"), "select_company");
  assert.equal(authorization.searchParams.get("state"), "random-state");
  assert.equal(authorization.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(authorization.searchParams.has("client_secret"), false);

  const fetcher: typeof fetch = async (resource, init) => {
    assert.equal(resource, "https://accounts.secure.freee.co.jp/public_api/token");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.body instanceof URLSearchParams);
    if (init.body.get("grant_type") === "authorization_code") {
      assert.equal(init.body.get("redirect_uri"), redirectUri);
      assert.equal(init.body.get("code"), "code");
      return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 21600, company_id: "123" });
    }
    assert.equal(init.body.get("grant_type"), "refresh_token");
    assert.equal(init.body.get("refresh_token"), "refresh");
    return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 21600 });
  };
  const credentials = { clientId: "example", clientSecret: "secret" };
  const first = await exchangeFreeeCode({ ...credentials, redirectUri, code: "code", fetcher });
  const next = await refreshFreeeTokens({ ...credentials, refreshToken: first.refreshToken, fetcher });
  assert.equal(first.companyId, 123);
  assert.ok(first.expiresAt > Date.now());
  assert.equal(next.companyId, null);
  assert.equal(next.refreshToken, "new-refresh");
});

const masters: Record<string, unknown> = {
  "/api/1/companies/123": { company: {
    id: 123,
    display_name: "テスト事業所",
    org_code: 2,
    fiscal_years: [{
      start_date: "2026-01-01", end_date: "2026-12-31", tax_method: 2, tax_account_method: 2,
      sales_tax_business_code: 4,
    }],
  } },
  "/api/1/account_items": { account_items: [
    { id: 1, name: "預金", account_category: "現金・預金" },
    { id: 2, name: "業務売上", account_category: "Web制作", categories: ["損益", "収入金額", "Web制作"] },
    { id: 3, name: "雑費", account_category: "経費" },
    { id: 4, name: "備品", account_category: "有形固定資産" },
  ] },
  "/api/1/taxes/companies/123": { taxes: [
    { code: 2, name_ja: "対象外" },
    { code: 129, name_ja: "課税売上10%" },
    { code: 130, name_ja: "課税売返10%" },
    { code: 131, name_ja: "課対仕入10%" },
    { code: 500, name_ja: "課対仕入（控80）10%" },
    { code: 502, name_ja: "共対仕入10%" },
  ] },
};

function detail(account_item_id: number, amount: number, tax_code: number, vat = 0) {
  return { line_type: "detail", account_item_id, amount, vat, tax_code };
}

function entry(id: number, debit: unknown[], credit: unknown[], txn_date = "2026-01-10") {
  return { id, txn_date, debit, credit };
}

test("syncs months through the cutoff, handles reversals, and counts recorded VAT once", async () => {
  const sales = entry(10, [detail(1, 11_000, 2)], [detail(2, 10_000, 129, 1_000), {
    line_type: "tax", account_item_id: 99, amount: 1_000, vat: null, tax_code: 129,
  }]);
  const expense = entry(11, [detail(3, 2_000, 131, 200)], [detail(1, 2_200, 2)]);
  const transitionalPurchase = entry(12, [detail(3, 10_200, 500, 800)], [detail(1, 11_000, 2)]);
  const asset = entry(13, [detail(4, 40_000, 131, 4_000)], [detail(1, 44_000, 2)]);
  const refund = entry(14, [detail(2, 1_000, 130, 100)], [detail(1, 1_100, 2)]);
  const allocatedPurchase = entry(15, [detail(3, 300, 502, 30)], [detail(1, 330, 2)], "2026-02-10");
  const pendingSale = { ...entry(16, [detail(1, 110_000, 2)], [detail(2, 100_000, 129, 10_000)]), approval_status: "in_progress" };
  const requests: Array<Record<string, string>> = [];
  const fetcher: typeof fetch = async (resource, init) => {
    const path = new URL(String(resource)).pathname;
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
    if (Object.hasOwn(masters, path)) return Response.json(masters[path]);
    assert.equal(path, "/api/1/journals/search");
    assert.equal(init?.method, "POST");
    assert.ok(typeof init.body === "string");
    const query = JSON.parse(init.body) as Record<string, string>;
    requests.push(query);
    if (query.start_issue_date === "2026-02-01") return Response.json({ data: [allocatedPurchase], next_page_token: null });
    if (query.start_issue_date === "2026-03-01") return Response.json({ data: [], next_page_token: null });
    if (query.page_token === "next") return Response.json({ data: [sales, refund], next_page_token: null });
    return Response.json({ data: [sales, expense, transitionalPurchase, asset, pendingSale], next_page_token: "next" });
  };
  const result = await syncFreeeAccounting({
    accessToken: "test-token", companyId: 123, year: 2026, throughMonth: 3, throughDate: "2026-03-18", fetcher,
  });
  assert.equal(result.companyName, "テスト事業所");
  assert.deepEqual(result.taxSettings, { method: "general", accounting: "net", simpleBusinessCategory: 5 });
  assert.deepEqual(result.months, [
    { month: 1, sales: 9_000, expenses: 12_200, salesTax: 900, deductiblePurchaseTax: 5_000 },
    { month: 2, sales: 0, expenses: 300, salesTax: 0, deductiblePurchaseTax: null },
    { month: 3, sales: 0, expenses: 0, salesTax: 0, deductiblePurchaseTax: 0 },
  ]);
  assert.equal(requests[0].end_issue_date, "2026-01-31");
  assert.equal(requests[1].page_token, "next");
  assert.equal(requests[3].end_issue_date, "2026-03-18");
});

test("rejects a sync if freee never advances its continuation token", async () => {
  const fetcher: typeof fetch = async (resource) => {
    const path = new URL(String(resource)).pathname;
    if (Object.hasOwn(masters, path)) return Response.json(masters[path]);
    return Response.json({ data: [], next_page_token: "same" });
  };
  await assert.rejects(syncFreeeAccounting({
    accessToken: "test-token", companyId: 123, year: 2026, throughMonth: 1, fetcher,
  }), FreeeApiError);
});
