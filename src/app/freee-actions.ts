"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { FORECAST_YEAR } from "@/lib/forecast";
import { FREEE_ISSUER, FreeeApiError, exchangeFreeeCode, freeeAuthorizationUrl, getFreeeCompany, refreshFreeeTokens, syncFreeeAccounting } from "@/lib/freee";
import { activeTokens, beginSync, connectionDetails, consumeOAuthAttempt, currentForecastDate, finishSync, saveConnection, saveOAuthAttempt } from "@/lib/forecast-store";
import { freeeSettings, localFreeeCallbackUrl } from "@/lib/freee-settings";
import { requireSession } from "@/lib/security";

function returnHome(notice: string): never {
  redirect(`/?notice=${notice}#freee`);
}

export async function startFreee(_data: FormData) {
  const session = await requireSession();
  const settings = freeeSettings();
  if (!settings) {
    if (localFreeeCallbackUrl()) redirect("/freee/setup");
    returnHome("not-configured");
  }
  const state = randomBytes(32).toString("base64url");
  await saveOAuthAttempt(state, session);
  redirect(freeeAuthorizationUrl({ ...settings, state }));
}

export async function completeFreee(form: FormData) {
  const session = await requireSession();
  const settings = freeeSettings();
  if (!settings) returnHome("not-configured");
  const code = form.get("code");
  const state = form.get("state");
  const issuer = form.get("iss");
  if (typeof code !== "string" || !code || code.length > 4096 || typeof state !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(state) || (issuer && issuer !== FREEE_ISSUER)
    || !(await consumeOAuthAttempt(state, session))) returnHome("invalid-oauth");

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
        outcome = await saveConnection(company.id, company.name, tokens) ? "connected" : "different-company";
      }
    }
  } catch {
    outcome = "connection-error";
  }
  returnHome(outcome);
}

export async function syncFreee(_data: FormData) {
  await requireSession();
  const settings = freeeSettings();
  if (!settings) returnHome("not-configured");
  const connection = await connectionDetails();
  if (!connection) returnHome("company-required");
  const date = currentForecastDate();
  if (!date.throughMonth) returnHome("before-year");
  const id = await beginSync(connection.version);
  if (!id) returnHome("sync-running");

  let outcome: string;
  try {
    const tokens = await activeTokens(connection.version, (current) => refreshFreeeTokens({
      ...settings, refreshToken: current.refreshToken,
    }));
    const deadline = AbortSignal.timeout(90_000);
    const snapshot = await syncFreeeAccounting({
      accessToken: tokens.accessToken, companyId: Number(connection.company_id), year: FORECAST_YEAR,
      throughMonth: date.throughMonth, throughDate: date.throughDate,
      fetcher: (request, init) => fetch(request, {
        ...init, signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
      }),
    });
    outcome = await finishSync(id, connection.version, { ...snapshot, closedThroughMonth: date.latestClosedMonth })
      ? "synced" : "connection-changed";
  } catch (error) {
    await finishSync(id, connection.version);
    outcome = "sync-error";
    if (error instanceof FreeeApiError) {
      if (["invalid_grant", "expired_access_token", "re_authorization_required"].includes(error.code ?? "")) outcome = "sync-reconnect";
      else if (error.status === 403 || error.code === "user_do_not_have_permission") outcome = "sync-permission";
      else if (error.status === 429) outcome = "sync-limit";
    }
  }
  returnHome(outcome);
}
