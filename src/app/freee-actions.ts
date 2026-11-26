"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { FORECAST_YEAR } from "@/lib/forecast";
import { FREEE_ISSUER, FreeeApiError, exchangeFreeeCode, freeeAuthorizationUrl, getFreeeCompany, refreshFreeeTokens, syncFreeeAccounting } from "@/lib/freee";
import { activeTokens, beginSync, clearOAuthAttempts, connectionDetails, consumeOAuthAttempt, currentForecastDate, finishSync, saveConnection, saveOAuthAttempt } from "@/lib/forecast-store";
import { freeeSettings, localFreeeCallbackUrl, setLocalFreeeCredentials } from "@/lib/freee-settings";
import { getMode, requireSession, switchMode } from "@/lib/security";

function returnHome(notice: string): never {
  redirect(`/?notice=${notice}#freee`);
}

async function redirectToFreee(session: string, settings: NonNullable<ReturnType<typeof freeeSettings>>) {
  const state = randomBytes(32).toString("base64url");
  await saveOAuthAttempt(state, session);
  redirect(freeeAuthorizationUrl({ ...settings, state }));
}

export async function startFreee(_data: FormData) {
  const session = await requireSession();
  const settings = freeeSettings();
  if (!settings && !localFreeeCallbackUrl()) returnHome("not-configured");
  if (await getMode() === "demo") await switchMode("real");
  if (!settings) redirect("/freee/setup");
  await redirectToFreee(session, settings);
}

export async function configureAndStartFreee(form: FormData) {
  const session = await requireSession();
  if (await getMode() !== "real" || !localFreeeCallbackUrl() || await connectionDetails()) redirect("/#freee");

  const submittedId = form.get("clientId");
  const submittedSecret = form.get("clientSecret");
  const clientId = typeof submittedId === "string" ? submittedId.trim() : "";
  const clientSecret = typeof submittedSecret === "string" ? submittedSecret.trim() : "";
  if (!/^[!-~]{1,512}$/.test(clientId) || !/^[!-~]{1,1024}$/.test(clientSecret)) redirect("/freee/setup?error=credentials");

  if (!setLocalFreeeCredentials({ clientId, clientSecret })) returnHome("not-configured");
  clearOAuthAttempts();
  const settings = freeeSettings();
  if (!settings) returnHome("not-configured");
  await redirectToFreee(session, settings);
}

export async function completeFreee(form: FormData) {
  const session = await requireSession();
  const settings = freeeSettings();
  if (!settings || (await getMode()) !== "real") returnHome("not-configured");
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
      const currentSettings = freeeSettings();
      if (currentSettings?.clientId !== settings.clientId || currentSettings.clientSecret !== settings.clientSecret
        || currentSettings.redirectUri !== settings.redirectUri) {
        outcome = "invalid-oauth";
      } else if (company.organizationType !== "individual") {
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
  if (!settings || (await getMode()) !== "real") returnHome("not-configured");
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
