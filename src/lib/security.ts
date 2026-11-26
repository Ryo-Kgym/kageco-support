import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { FreeeTokens } from "./freee";

export type FreeeSession = {
  id: string;
  companyId: number;
  companyName: string;
  expiresAt: number;
};

type CookieStore = Awaited<ReturnType<typeof cookies>>;

const oauthLifetime = 10 * 60;
const sessionLifetime = 8 * 60 * 60;
const maxCookieLength = 3_800;
const ivLength = 12;
const tagLength = 16;

function isRandomId(value: unknown): value is string {
  return typeof value === "string" && value.length === 43 && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function sessionKey() {
  const value = process.env.SESSION_SECRET;
  if (!isRandomId(value)) return null;
  const key = Buffer.from(value, "base64url");
  return key.length === 32 && key.toString("base64url") === value ? key : null;
}

export function authConfigured() {
  return sessionKey() !== null;
}

function secureCookies() {
  return process.env.NODE_ENV === "production" || process.env.APP_ORIGIN?.startsWith("https:") === true;
}

function cookieName(suffix: string) {
  return `${secureCookies() ? "__Host-" : ""}kageco_freee_${suffix}`;
}

function writeCookie(store: CookieStore, name: string, value: string, maxAge: number) {
  store.set(name, value, { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/", maxAge });
}

function sealCookie(name: string, value: object) {
  const key = sessionKey();
  if (!key) throw new Error("SESSION_SECRET is not configured");

  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: tagLength });
  cipher.setAAD(Buffer.from(`kageco-support:v1:${name}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  if (sealed.length > maxCookieLength) throw new Error("freee session cookie exceeds its size limit");
  return sealed;
}

function openCookie(store: CookieStore, name: string): Record<string, unknown> | null {
  const key = sessionKey();
  const value = store.get(name)?.value;
  if (!key || !value || value.length > maxCookieLength || !/^[A-Za-z0-9_-]+$/.test(value)) return null;

  const sealed = Buffer.from(value, "base64url");
  if (sealed.length <= ivLength + tagLength || sealed.toString("base64url") !== value) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, ivLength), { authTagLength: tagLength });
    decipher.setAAD(Buffer.from(`kageco-support:v1:${name}`));
    decipher.setAuthTag(sealed.subarray(ivLength, ivLength + tagLength));
    const plaintext = Buffer.concat([decipher.update(sealed.subarray(ivLength + tagLength)), decipher.final()]);
    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readSession(store: CookieStore): FreeeSession | null {
  const value = openCookie(store, cookieName("session"));
  if (!value) return null;
  const { id, companyId, companyName, expiresAt } = value;
  if (!isRandomId(id) || !isPositiveInteger(companyId) ||
      typeof companyName !== "string" || !companyName || !isPositiveInteger(expiresAt) || expiresAt <= Date.now()) return null;
  return { id, companyId, companyName, expiresAt };
}

export async function currentSession() {
  return readSession(await cookies());
}

export async function requireSession() {
  const session = await currentSession();
  if (!session) redirect("/");
  return session;
}

export async function beginFreeeLogin() {
  const store = await cookies();
  const name = cookieName("oauth");
  const state = randomBytes(32).toString("base64url");
  const attempt = { state, sessionId: readSession(store)?.id ?? null, expiresAt: Date.now() + oauthLifetime * 1000 };
  writeCookie(store, name, sealCookie(name, attempt), oauthLifetime);
  return state;
}

function matchesAttempt(store: CookieStore, state: string) {
  if (!isRandomId(state)) return false;
  const attempt = openCookie(store, cookieName("oauth"));
  return Boolean(attempt && isRandomId(attempt.state) &&
    isPositiveInteger(attempt.expiresAt) && attempt.expiresAt > Date.now() &&
    attempt.sessionId === (readSession(store)?.id ?? null) &&
    timingSafeEqual(Buffer.from(attempt.state), Buffer.from(state)));
}

export async function matchesFreeeLogin(state: string) {
  return matchesAttempt(await cookies(), state);
}

export async function consumeFreeeLogin(state: string) {
  const store = await cookies();
  if (!matchesAttempt(store, state)) return false;
  writeCookie(store, cookieName("oauth"), "", 0);
  return true;
}

function tokenCookieName(session: FreeeSession) {
  return cookieName(`tokens_${session.id}`);
}

function readTokens(value: Record<string, unknown>, companyId: number): FreeeTokens | null {
  const { accessToken, refreshToken, expiresAt } = value;
  if (typeof accessToken !== "string" || !accessToken || typeof refreshToken !== "string" || !refreshToken ||
      !isPositiveInteger(expiresAt) || (value.companyId !== null && value.companyId !== companyId)) return null;
  return { accessToken, refreshToken, expiresAt, companyId: value.companyId };
}

function sealTokens(session: FreeeSession, tokens: FreeeTokens) {
  if (!readTokens(tokens, session.companyId)) throw new Error("freee tokens do not match the session");
  return sealCookie(tokenCookieName(session), tokens);
}

export async function createFreeeSession(companyId: number, companyName: string, tokens: FreeeTokens) {
  if (!isPositiveInteger(companyId) || !companyName) throw new Error("Invalid freee company");
  const store = await cookies();
  const previous = readSession(store);
  const session = { id: randomBytes(32).toString("base64url"), companyId, companyName, expiresAt: Date.now() + sessionLifetime * 1000 };
  const name = cookieName("session");
  const sealedSession = sealCookie(name, session);
  const sealedTokens = sealTokens(session, tokens);

  if (previous) writeCookie(store, tokenCookieName(previous), "", 0);
  writeCookie(store, tokenCookieName(session), sealedTokens, sessionLifetime);
  writeCookie(store, name, sealedSession, sessionLifetime);
  return session;
}

export async function getSessionTokens(session: FreeeSession) {
  const store = await cookies();
  if (readSession(store)?.id !== session.id) return null;
  const value = openCookie(store, tokenCookieName(session));
  return value ? readTokens(value, session.companyId) : null;
}

export async function saveSessionTokens(session: FreeeSession, tokens: FreeeTokens) {
  const store = await cookies();
  const current = readSession(store);
  if (current?.id !== session.id) return;
  const maxAge = Math.floor((current.expiresAt - Date.now()) / 1000);
  if (maxAge > 0) writeCookie(store, tokenCookieName(current), sealTokens(current, tokens), maxAge);
}

export async function clearFreeeSession() {
  const store = await cookies();
  const session = readSession(store);
  if (session) writeCookie(store, tokenCookieName(session), "", 0);
  writeCookie(store, cookieName("session"), "", 0);
  writeCookie(store, cookieName("oauth"), "", 0);
  writeCookie(store, "kageco_session", "", 0);
}
