import "server-only";

type FreeeCredentials = { clientId: string; clientSecret: string };
type FreeeSettings = FreeeCredentials & { redirectUri: string };

const server = globalThis as typeof globalThis & { kagecoLocalFreeeCredentials?: FreeeCredentials };

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

export function setLocalFreeeCredentials(credentials: FreeeCredentials) {
  if (!localFreeeCallbackUrl()) return false;
  server.kagecoLocalFreeeCredentials = credentials;
  return true;
}

export function freeeSettings(): FreeeSettings | null {
  const origin = configuredOrigin();
  if (!origin) return null;
  const credentials = environmentCredentials() ?? (localFreeeCallbackUrl() ? server.kagecoLocalFreeeCredentials : undefined);
  return credentials ? { ...credentials, redirectUri: `${origin.origin}/freee/callback` } : null;
}
