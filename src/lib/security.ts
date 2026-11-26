import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const sessionCookie = "kageco_session";
const sessionDuration = 8 * 60 * 60;
export const modeCookie = "kageco_forecast_mode";

export const localOpenAccess = () => process.env.NODE_ENV === "development" && !process.env.APP_PASSWORD;

function sessionKey() {
  const value = process.env.SESSION_SECRET;
  const key = value ? Buffer.from(value, "base64url") : undefined;
  return key?.length === 32 ? key : undefined;
}

export function authConfigured() {
  return localOpenAccess() || Boolean(process.env.APP_PASSWORD && process.env.APP_PASSWORD.length >= 24 && sessionKey());
}

function secureCookie() {
  return process.env.NODE_ENV === "production" || process.env.APP_ORIGIN?.startsWith("https:") || false;
}

function sealSession(value: string, key: Buffer) {
  return createHmac("sha256", key).update(value).digest("base64url");
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

export async function sessionId(): Promise<string | null> {
  if (localOpenAccess()) return "local-owner";
  if (!authConfigured()) return null;
  const key = sessionKey();
  const cookie = (await cookies()).get(sessionCookie)?.value;
  if (!key || !cookie) return null;
  const [id, timestamp, signature] = cookie.split(".");
  if (!id || !timestamp || !signature || Number(timestamp) <= Date.now()) return null;
  const expected = Buffer.from(sealSession(`${id}.${timestamp}`, key));
  const supplied = Buffer.from(signature);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? id : null;
}

export async function requireSession() {
  const id = await sessionId();
  if (!id) redirect("/");
  return id;
}

export async function signIn(password: string) {
  const configured = process.env.APP_PASSWORD;
  const key = sessionKey();
  if (!configured || configured.length < 24 || !key || password.length > 512) return false;
  if (!timingSafeEqual(sha256(password), sha256(configured))) return false;
  const id = randomBytes(32).toString("base64url");
  const value = `${id}.${Date.now() + sessionDuration * 1000}`;
  (await cookies()).set(sessionCookie, `${value}.${sealSession(value, key)}`, {
    httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/", maxAge: sessionDuration,
  });
  return true;
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(sessionCookie);
  jar.delete(modeCookie);
}

export async function getMode(): Promise<"real" | "demo"> {
  return (await cookies()).get(modeCookie)?.value === "demo" ? "demo" : "real";
}

export async function switchMode(mode: "real" | "demo") {
  (await cookies()).set(modeCookie, mode, { httpOnly: true, secure: secureCookie(), sameSite: "lax", path: "/" });
}
