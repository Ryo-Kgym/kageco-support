import "server-only";

type FreeeCredentials = { clientId: string; clientSecret: string };
type FreeeSettings = FreeeCredentials & { redirectUri: string };

function environmentCredentials(): FreeeCredentials | null {
  const clientId = process.env.FREEE_CLIENT_ID;
  const clientSecret = process.env.FREEE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function loopback(url: URL) {
  return ["127.0.0.1", "localhost"].includes(url.hostname);
}

function configuredOrigin() {
  const appOrigin = process.env.APP_ORIGIN ?? (process.env.NODE_ENV === "development" ? "http://127.0.0.1:3000" : undefined);
  if (!appOrigin) return null;
  try {
    const url = new URL(appOrigin);
    if (url.origin !== appOrigin || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url)))) return null;
    return url;
  } catch {
    return null;
  }
}

export function localFreeeCallbackUrl() {
  const origin = configuredOrigin();
  if (process.env.NODE_ENV !== "development" || !origin || !loopback(origin) || environmentCredentials()) return null;
  return `${origin.origin}/freee/callback`;
}

export function freeeSettings(): FreeeSettings | null {
  const origin = configuredOrigin();
  if (!origin) return null;
  const credentials = environmentCredentials();
  return credentials ? { ...credentials, redirectUri: `${origin.origin}/freee/callback` } : null;
}
