import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const sessionCookie = "kageco_session";
const sessionDuration = 8 * 60 * 60;
export const modeCookie = "kageco_forecast_mode";

export const localOpenAccess = () => process.env.NODE_ENV === "development" && !process.env.APP_PASSWORD;

function environmentKey(name: string) {
  const value = process.env[name];
  const key = value ? Buffer.from(value, "base64url") : undefined;
  return key?.length === 32 ? key : undefined;
}

function sessionKey() {
  return environmentKey("SESSION_SECRET");
}

export const encryptionConfigured = () => Boolean(environmentKey("FREEE_TOKEN_KEY"));

export function authConfigured() {
  return localOpenAccess() || Boolean(process.env.APP_PASSWORD && process.env.APP_PASSWORD.length >= 24 && sessionKey());
}

function secureCookie() {
  return process.env.NODE_ENV === "production" || process.env.APP_ORIGIN?.startsWith("https:") || false;
}

function sealSession(value: string, key: Buffer) {
  return createHmac("sha256", key).update(value).digest("base64url");
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

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
  if (!timingSafeEqual(Buffer.from(sha256(password), "hex"), Buffer.from(sha256(configured), "hex"))) return false;
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

function encryptionKey() {
  const key = environmentKey("FREEE_TOKEN_KEY");
  if (!key) throw new Error("FREEE_TOKEN_KEY is required");
  return key;
}

export function encryptTokenValues(value: object) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptTokenValues<T>(payload: string): T {
  const [iv, tag, ciphertext] = payload.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !ciphertext) throw new Error("Invalid encrypted token payload");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as T;
}
