import "server-only";

type FreeeCredentials = { clientId: string; clientSecret: string };
type FreeeSettings = FreeeCredentials & { redirectUri: string };

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

export function freeeConfiguration() {
  const origin = configuredOrigin();
  const clientId = process.env.FREEE_CLIENT_ID?.trim();
  const clientSecret = process.env.FREEE_CLIENT_SECRET?.trim();
  const issues: string[] = [];
  if (!origin) issues.push("APP_ORIGIN");
  if (!clientId) issues.push("FREEE_CLIENT_ID");
  if (!clientSecret) issues.push("FREEE_CLIENT_SECRET");
  const settings: FreeeSettings | null = origin && clientId && clientSecret
    ? { clientId, clientSecret, redirectUri: `${origin.origin}/freee/callback` }
    : null;
  return { settings, issues };
}

export function freeeSettings(): FreeeSettings | null {
  return freeeConfiguration().settings;
}
