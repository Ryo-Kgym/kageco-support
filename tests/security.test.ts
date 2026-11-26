import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import Module, { createRequire } from "node:module";
import { afterEach, before, beforeEach, test } from "node:test";

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  path: string;
  maxAge: number;
};
type BrowserCookies = Map<string, { value: string; options: CookieOptions }>;

let browser: BrowserCookies;
let security: typeof import("../src/lib/security");
const previousSecret = process.env.SESSION_SECRET;
const previousOrigin = process.env.APP_ORIGIN;

before(async () => {
  const require = createRequire(import.meta.url);
  // Mock only the Next.js request boundary. The cookie sealing and validation run normally.
  const nextModules = [
    ["next/headers", {
      cookies: async () => ({
        get: (name: string) => browser.get(name),
        set: (name: string, value: string, options: CookieOptions) => {
          if (options.maxAge === 0) browser.delete(name);
          else browser.set(name, { value, options });
        },
      }),
    }],
    ["next/navigation", { redirect: (location: string) => { throw new Error(location); } }],
  ] as const;
  const originals = nextModules.map(([name, exports]) => {
    const path = require.resolve(name);
    const original = require.cache[path];
    require.cache[path] = Object.assign(new Module(path), { filename: path, loaded: true, exports });
    return { path, original };
  });
  try {
    security = await import("../src/lib/security");
  } finally {
    for (const { path, original } of originals) {
      if (original) require.cache[path] = original;
      else delete require.cache[path];
    }
  }
});

beforeEach(() => {
  browser = new Map();
  process.env.SESSION_SECRET = randomBytes(32).toString("base64url");
  process.env.APP_ORIGIN = "https://example.invalid";
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
  if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
  else process.env.APP_ORIGIN = previousOrigin;
});

test("freee OAuth state belongs to the starting browser and is consumed once", async () => {
  const state = await security.beginFreeeLogin();
  const firstBrowser = browser;
  assert.deepEqual(firstBrowser.get("__Host-kageco_freee_oauth")?.options, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
  });

  browser = new Map();
  assert.equal(await security.consumeFreeeLogin(state), false);
  browser = firstBrowser;
  assert.equal(await security.consumeFreeeLogin("invalid"), false);
  assert.equal(await security.consumeFreeeLogin(state + "\n"), false);
  assert.equal(await security.matchesFreeeLogin(state), true);
  assert.equal(await security.consumeFreeeLogin(state), true);
  assert.equal(await security.matchesFreeeLogin(state), false);
});

test("freee session tokens stay encrypted and cannot transfer between sessions for the same company", async () => {
  const tokens = { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresAt: Date.now() + 60_000, companyId: 10 };
  const first = await security.createFreeeSession(10, "事業所", tokens);
  const firstTokenCookie = browser.get(`__Host-kageco_freee_tokens_${first.id}`);
  assert.ok(firstTokenCookie);
  assert.equal(Buffer.from(firstTokenCookie.value, "base64url").includes(Buffer.from(tokens.refreshToken)), false);
  assert.deepEqual(await security.getSessionTokens(first), tokens);

  browser = new Map();
  const second = await security.createFreeeSession(10, "事業所", tokens);
  assert.notEqual(second.id, first.id);
  assert.equal(await security.getSessionTokens(first), null);
  browser.set(`__Host-kageco_freee_tokens_${second.id}`, firstTokenCookie);
  assert.equal(await security.getSessionTokens(second), null);

  await security.clearFreeeSession();
  await security.saveSessionTokens(second, tokens);
  assert.equal(await security.currentSession(), null);
  assert.equal(browser.size, 0);
});

test("expired, tampered and unconfigured identity cookies do not authenticate", async (t) => {
  const tokens = { accessToken: "fixture-access", refreshToken: "fixture-refresh", expiresAt: Date.now() + 60_000, companyId: 10 };
  const loggedIn = await security.createFreeeSession(10, "事業所", tokens);
  const name = "__Host-kageco_freee_session";
  const original = browser.get(name);
  assert.ok(original);
  const prefix = original.value.startsWith("A") ? "B" : "A";
  browser.set(name, { ...original, value: prefix + original.value.slice(1) });
  assert.equal(await security.currentSession(), null);
  browser.set(name, original);
  t.mock.method(Date, "now", () => loggedIn.expiresAt);
  assert.equal(await security.currentSession(), null);

  delete process.env.SESSION_SECRET;
  assert.equal(security.authConfigured(), false);
  await assert.rejects(security.requireSession(), { message: "/" });
});
