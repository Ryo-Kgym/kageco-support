import assert from "node:assert/strict";
import test from "node:test";
import { freeeSettings, localFreeeCallbackUrl } from "../src/lib/freee-settings";

test("freee connection requires both server environment variables", (t) => {
  const originalEnvironment = process.env;
  t.after(() => { process.env = originalEnvironment; });
  process.env = {
    ...originalEnvironment,
    NODE_ENV: "development",
    APP_ORIGIN: "http://127.0.0.1:3000",
    FREEE_CLIENT_ID: "test-client",
    FREEE_CLIENT_SECRET: "",
  };

  assert.equal(freeeSettings(), null);
  assert.equal(localFreeeCallbackUrl(), "http://127.0.0.1:3000/freee/callback");

  process.env.FREEE_CLIENT_SECRET = "test-secret";
  assert.deepEqual(freeeSettings(), {
    clientId: "test-client",
    clientSecret: "test-secret",
    redirectUri: "http://127.0.0.1:3000/freee/callback",
  });
  assert.equal(localFreeeCallbackUrl(), null);
});
