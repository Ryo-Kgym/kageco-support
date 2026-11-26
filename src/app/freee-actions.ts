"use server";

import { headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { FREEE_ISSUER, FreeeApiError, exchangeFreeeCode, freeeAuthorizationUrl, getFreeeCompany, refreshFreeeTokens, revokeFreeeTokens, syncFreeeAccounting } from "@/lib/freee";
import { activeTokens, beginSync, closeForecastSession, currentForecastDate, finishSync } from "@/lib/forecast-store";
import { freeeSettings } from "@/lib/freee-settings";
import { forecastLocation, isForecastYear } from "@/lib/forecast-year";
import { authConfigured, beginFreeeLogin, clearFreeeSession, consumeFreeeLogin, createFreeeSession, currentSession, getSessionTokens, requireSession, saveSessionTokens } from "@/lib/security";

function returnHome(notice: string, year?: number): never {
  redirect(year === undefined ? `/?notice=${notice}#freee` : forecastLocation(year, notice, "freee"));
}

function returnFromLogin(notice: string): never {
  redirect(`/?notice=${notice}`, RedirectType.replace);
}

class FreeeSettingsRequiredError extends Error {}

export async function startFreee(_data: FormData) {
  const settings = freeeSettings();
  if (!settings || !authConfigured()) returnHome("not-configured");
  const callback = new URL(settings.redirectUri);
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (host && host !== callback.host) redirect(callback.origin);

  const state = await beginFreeeLogin();
  redirect(freeeAuthorizationUrl({ ...settings, state }));
}

export async function completeFreee(form: FormData) {
  const settings = freeeSettings();
  if (!settings || !authConfigured()) returnFromLogin("not-configured");
  const code = form.get("code");
  const state = form.get("state");
  const issuer = form.get("iss");
  if (typeof code !== "string" || !code || code.length > 4096 || typeof state !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(state) || (issuer && issuer !== FREEE_ISSUER)) returnFromLogin("invalid-oauth");
  if (!(await consumeFreeeLogin(state))) returnFromLogin("invalid-oauth");

  let outcome: string;
  try {
    const tokens = await exchangeFreeeCode({ ...settings, code });
    if (tokens.companyId === null) {
      outcome = "company-required";
    } else {
      const company = await getFreeeCompany({ accessToken: tokens.accessToken, companyId: tokens.companyId });
      if (company.organizationType !== "individual") {
        outcome = "individual-required";
      } else {
        const previous = await currentSession();
        await createFreeeSession(company.id, company.name, tokens);
        if (previous) await closeForecastSession(previous);
        outcome = "connected";
      }
    }
  } catch {
    outcome = "connection-error";
  }
  returnFromLogin(outcome);
}

export async function disconnectFreee(_data: FormData) {
  const session = await requireSession();
  const cookieTokens = await getSessionTokens(session);
  const cachedTokens = await closeForecastSession(session);
  await clearFreeeSession();
  const tokens = cachedTokens && (!cookieTokens || cachedTokens.expiresAt >= cookieTokens.expiresAt) ? cachedTokens : cookieTokens;
  if (!tokens) returnHome("disconnected");
  const revoked = await revokeFreeeTokens(tokens);
  returnHome(revoked ? "disconnected" : "disconnect-unconfirmed");
}

export async function syncFreee(year: number, _data: FormData) {
  if (!isForecastYear(year)) redirect("/");
  const session = await requireSession();
  const date = currentForecastDate(year);
  if (!date.throughMonth) returnHome("before-year", year);
  const settings = freeeSettings();
  const cookieTokens = await getSessionTokens(session);
  if (!cookieTokens) returnHome("sync-reconnect", year);
  const id = await beginSync(session, year);
  if (!id) returnHome("sync-running", year);

  let outcome: string;
  try {
    const tokens = await activeTokens(session, cookieTokens, (current) => {
      if (!settings) throw new FreeeSettingsRequiredError();
      return refreshFreeeTokens({ ...settings, refreshToken: current.refreshToken });
    });
    if (!tokens) {
      await finishSync(session, id, undefined, year);
      outcome = "sync-reconnect";
    } else {
      if (tokens !== cookieTokens) await saveSessionTokens(session, tokens);
      const deadline = AbortSignal.timeout(90_000);
      const snapshot = await syncFreeeAccounting({
        accessToken: tokens.accessToken, companyId: session.companyId, year,
        throughMonth: date.throughMonth, throughDate: date.throughDate,
        fetcher: (request, init) => fetch(request, {
          ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
        }),
      });
      outcome = await finishSync(session, id, { ...snapshot, closedThroughMonth: date.latestClosedMonth }, year)
        ? "synced" : "connection-changed";
    }
  } catch (error) {
    await finishSync(session, id, undefined, year);
    outcome = error instanceof FreeeSettingsRequiredError ? "not-configured" : "sync-error";
    if (error instanceof FreeeApiError) {
      if (["invalid_grant", "expired_access_token", "re_authorization_required"].includes(error.code ?? "")) {
        outcome = settings ? "sync-reconnect" : "not-configured";
      } else if (error.status === 403 || error.code === "user_do_not_have_permission") outcome = "sync-permission";
      else if (error.status === 429) outcome = "sync-limit";
    }
  }
  returnHome(outcome, year);
}
