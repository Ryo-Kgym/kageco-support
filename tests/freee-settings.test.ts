import assert from "node:assert/strict";
import test from "node:test";
import { freeeConfiguration, freeeSettings } from "../src/lib/freee-settings";

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
  assert.deepEqual(freeeConfiguration().issues, ["FREEE_CLIENT_SECRET"]);

  process.env.FREEE_CLIENT_SECRET = "test-secret";
  assert.deepEqual(freeeSettings(), {
    clientId: "test-client",
    clientSecret: "test-secret",
    redirectUri: "http://127.0.0.1:3000/freee/callback",
  });
  assert.deepEqual(freeeConfiguration().issues, []);

  process.env.APP_ORIGIN = "http://127.0.0.1:3000/invalid";
  process.env.FREEE_CLIENT_ID = " ";
  assert.equal(freeeSettings(), null);
  assert.deepEqual(freeeConfiguration().issues, ["APP_ORIGIN", "FREEE_CLIENT_ID"]);
});
