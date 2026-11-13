import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

const workerPath = new URL("../admin/worker.js", import.meta.url);
const original = fs.readFileSync(workerPath, "utf8");
const workerSource = original.replace("export default { fetch: handle };", "globalThis.__worker = { fetch: handle };");
assert.notEqual(workerSource, original, "Worker export hook must be found");

const store = new Map();
const kv = {
  async get(key, type) {
    const value = store.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  },
  async put(key, value) { store.set(key, value); },
  async delete(key) { store.delete(key); },
  async list({ prefix = "", limit = 1000, cursor } = {}) {
    const all = [...store.keys()].filter(key => key.startsWith(prefix)).sort();
    const offset = cursor ? Number(cursor) : 0;
    const keys = all.slice(offset, offset + limit).map(name => ({ name }));
    const next = offset + keys.length;
    const list_complete = next >= all.length;
    return { keys, list_complete, cursor: list_complete ? undefined : String(next) };
  }
};
const sandbox = {
  crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Map, Date, Math, JSON,
  URL, Request, Response, Headers, atob, btoa, console
};
vm.runInNewContext(workerSource, sandbox, { filename: "admin/worker.js" });
const fetchWorker = sandbox.__worker.fetch;
const env = {
  ADMIN_PASSWORD: "initial-bootstrap-password",
  SESSION_SECRET: "test-session-secret-with-enough-entropy",
  LOGIN_LIMITS: kv
};
const base = "https://hamoso-admin-auth.hamososaitoguanli.workers.dev";

async function call(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetchWorker(new Request(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

const bootstrapLogin = await call("/api/login", { method: "POST", body: { password: env.ADMIN_PASSWORD } });
assert.equal(bootstrapLogin.status, 200, "bootstrap password must work before a password hash exists");
const oldToken = bootstrapLogin.data.token;
assert.ok(oldToken, "login must return a session token");

const shortPassword = await call("/api/password/change", {
  method: "POST", token: oldToken,
  body: { currentPassword: env.ADMIN_PASSWORD, newPassword: "short", confirmPassword: "short" }
});
assert.equal(shortPassword.status, 400, "password shorter than 12 characters must be rejected");

const mismatch = await call("/api/password/change", {
  method: "POST", token: oldToken,
  body: { currentPassword: env.ADMIN_PASSWORD, newPassword: "new-strong-password-2026", confirmPassword: "different-password" }
});
assert.equal(mismatch.status, 400, "password confirmation mismatch must be rejected");

const newPassword = "new-strong-password-2026";
const changed = await call("/api/password/change", {
  method: "POST", token: oldToken,
  body: { currentPassword: env.ADMIN_PASSWORD, newPassword, confirmPassword: newPassword }
});
assert.equal(changed.status, 200, "valid password change must succeed");
const savedHash = store.get("auth:password-hash");
assert.ok(savedHash && savedHash.startsWith("pbkdf2$"), "password must be stored as a PBKDF2 hash");
assert.notEqual(savedHash, newPassword, "plaintext password must not be stored");

const oldSession = await call("/api/session", { token: oldToken });
assert.equal(oldSession.status, 401, "password change must invalidate existing sessions");

const oldPasswordLogin = await call("/api/login", { method: "POST", body: { password: env.ADMIN_PASSWORD } });
assert.equal(oldPasswordLogin.status, 401, "old bootstrap password must stop working after password change");

const newPasswordLogin = await call("/api/login", { method: "POST", body: { password: newPassword } });
assert.equal(newPasswordLogin.status, 200, "new password must work after password change");
const newToken = newPasswordLogin.data.token;
const newSession = await call("/api/session", { token: newToken });
assert.equal(newSession.status, 200, "new session must be valid");

const wrongCurrent = await call("/api/password/change", {
  method: "POST", token: newToken,
  body: { currentPassword: "incorrect-current-password", newPassword: "another-strong-password", confirmPassword: "another-strong-password" }
});
assert.equal(wrongCurrent.status, 401, "incorrect current password must be rejected");
assert.equal(store.get("auth:password-hash"), savedHash, "incorrect current password must not change the saved hash");

console.log("Password management tests passed: bootstrap login, minimum length, confirmation, PBKDF2 storage, session invalidation, old/new login, and current-password verification.");
