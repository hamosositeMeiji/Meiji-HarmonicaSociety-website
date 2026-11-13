import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
const workerPath = new URL("../admin/worker.js", import.meta.url);
const original = fs.readFileSync(workerPath, "utf8");
const source = original.replace("export default { fetch: handle };", "globalThis.__worker = { fetch: handle };");
assert.notEqual(source, original);
const data = new Map();
const kv = {
  async get(k, type) { const v = data.get(k); return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
  async put(k, v) { data.set(k, v); },
  async delete(k) { data.delete(k); },
  async list({ prefix = "", limit = 1000, cursor } = {}) {
    const keys = [...data.keys()].filter(k => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = keys.slice(start, start + limit).map(name => ({ name }));
    const next = start + page.length;
    return { keys: page, list_complete: next >= keys.length, cursor: next >= keys.length ? undefined : String(next) };
  }
};
const sandbox = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Map, Date, Math, JSON, URL, Request, Response, Headers, atob, btoa };
vm.runInNewContext(source, sandbox);
const env = { ADMIN_PASSWORD: "A".repeat(24), SESSION_SECRET: "S".repeat(48), LOGIN_LIMITS: kv };
const root = "https://hamoso-admin-auth.hamososaitoguanli.workers.dev";
async function call(path, method = "GET", token, body) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await sandbox.__worker.fetch(new Request(root + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  let json = {}; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const unauthenticatedChange = await call("/api/password/change", "POST", null, { currentPassword: env.ADMIN_PASSWORD, newPassword: "B".repeat(24), confirmPassword: "B".repeat(24) });
assert.equal(unauthenticatedChange.status, 401);
const first = await call("/api/login", "POST", null, { password: env.ADMIN_PASSWORD });
assert.equal(first.status, 200);
const secondOldLogin = await call("/api/login", "POST", null, { password: env.ADMIN_PASSWORD });
assert.equal(secondOldLogin.status, 200);
const oldToken = first.json.token;
const secondOldToken = secondOldLogin.json.token;
const short = await call("/api/password/change", "POST", oldToken, { currentPassword: env.ADMIN_PASSWORD, newPassword: "x", confirmPassword: "x" });
assert.equal(short.status, 400);
const nextPassword = "B".repeat(24);
const mismatch = await call("/api/password/change", "POST", oldToken, { currentPassword: env.ADMIN_PASSWORD, newPassword: nextPassword, confirmPassword: "C".repeat(24) });
assert.equal(mismatch.status, 400);
const changed = await call("/api/password/change", "POST", oldToken, { currentPassword: env.ADMIN_PASSWORD, newPassword: nextPassword, confirmPassword: nextPassword });
assert.equal(changed.status, 200);
const saved = data.get("auth:password-hash");
assert.ok(saved.startsWith("pbkdf2$"));
assert.notEqual(saved, nextPassword);
assert.equal((await call("/api/session", "GET", oldToken)).status, 401);
assert.equal((await call("/api/session", "GET", secondOldToken)).status, 401, "all active sessions must be invalidated");
assert.equal((await call("/api/login", "POST", null, { password: env.ADMIN_PASSWORD })).status, 401);
const second = await call("/api/login", "POST", null, { password: nextPassword });
assert.equal(second.status, 200);
assert.equal((await call("/api/session", "GET", second.json.token)).status, 200);
const wrong = await call("/api/password/change", "POST", second.json.token, { currentPassword: "C".repeat(24), newPassword: "D".repeat(24), confirmPassword: "D".repeat(24) });
assert.equal(wrong.status, 401);
assert.equal(data.get("auth:password-hash"), saved);
console.log("Password Worker tests passed: authentication, bootstrap login, length and confirmation validation, PBKDF2 storage, multi-session invalidation, and new/old password checks.");
