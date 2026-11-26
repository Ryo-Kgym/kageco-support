import "server-only";
import { encryptionConfigured } from "./security";

export function freeeSettings() {
  const clientId = process.env.FREEE_CLIENT_ID;
  const clientSecret = process.env.FREEE_CLIENT_SECRET;
  const appOrigin = process.env.APP_ORIGIN ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:3000" : undefined);
  if (!clientId || !clientSecret || !appOrigin || !encryptionConfigured()) return null;
  try {
    const url = new URL(appOrigin);
    const isLocal = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
    if (url.origin !== appOrigin || (url.protocol !== "https:" && !isLocal)) return null;
    return { clientId, clientSecret, redirectUri: `${url.origin}/freee/callback` };
  } catch {
    return null;
  }
}
